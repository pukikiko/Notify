import { parseFile } from 'music-metadata'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { ART_DIR } from './config.js'
import { spSearchAlbums, spSearchTracks, spArtistDetail, spArtistRelated, fetchSpotifyImage } from './spotify.js'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360
  s /= 100
  l /= 100
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

/** Deterministic placeholder cover (a smooth vertical gradient derived from
    the album name) so every album has artwork, even when Spotify and the
    source files don't provide one. Returns the PNG bytes. */
export function generateAlbumCover(seed) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const hue = h % 360
  const top = hslToRgb(hue, 55, 38)
  const bottom = hslToRgb((hue + 45) % 360, 65, 16)

  const size = 256
  const raw = Buffer.alloc(size * (1 + size * 4))
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4)
    raw[rowStart] = 0
    const t = y / (size - 1)
    const r = Math.round(top[0] + (bottom[0] - top[0]) * t)
    const g = Math.round(top[1] + (bottom[1] - top[1]) * t)
    const b = Math.round(top[2] + (bottom[2] - top[2]) * t)
    for (let x = 0; x < size; x++) {
      const o = rowStart + 1 + x * 4
      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
      raw[o + 3] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

/** Read embedded tags + cover art from a downloaded audio file. */
export async function extractFileMetadata(filePath) {
  const mm = await parseFile(filePath, { duration: true, skipCovers: false })
  const common = mm.common || {}
  const picture = Array.isArray(common.picture) ? common.picture[0] : null
  let coverPath = null
  if (picture && picture.data) {
    const ext = picture.format.includes('png') ? 'png' : 'jpg'
    coverPath = path.join(ART_DIR, `embedded-${path.basename(filePath, path.extname(filePath))}.${ext}`)
    if (!fs.existsSync(coverPath)) fs.writeFileSync(coverPath, picture.data)
  }
  return {
    title: common.title || path.basename(filePath, path.extname(filePath)),
    artist: common.artist || common.albumartist || 'Unknown Artist',
    album: common.album || null,
    albumartist: common.albumartist || null,
    trackNo: common.track && common.track.no,
    discNo: common.disk && common.disk.no,
    genres: common.genre || [],
    duration: Math.round(mm.format.duration || 0),
    bitrate: Math.round((mm.format.bitrate || 0) / 1000),
    sourceFormat: (path.extname(filePath) || '.flac').replace('.', '') || 'flac',
    picture: picture ? { type: picture.type } : null,
    coverPath,
    size: fs.statSync(filePath).size
  }
}

/** Pull just the embedded cover out of an audio file (no tag/duration parsing). */
export async function extractEmbeddedCover(filePath) {
  try {
    const mm = await parseFile(filePath, { duration: false, skipCovers: false })
    const picture = Array.isArray(mm.common.picture) ? mm.common.picture[0] : null
    if (!picture?.data) return null
    const data = picture.data
    const isPng = picture.format?.includes('png') || (data[0] === 0x89 && data[1] === 0x50)
    return { data, contentType: isPng ? 'image/png' : 'image/jpeg' }
  } catch {
    return null
  }
}

export async function saveTrackCover(trackId, buffer, contentType) {
  const ext = (contentType || '').includes('png') ? 'png' : 'jpg'
  const p = path.join(ART_DIR, `track-${trackId}.${ext}`)
  fs.writeFileSync(p, buffer)
  return p
}

/** Best-effort enrichment. Never throws; returns null on any failure. */
export async function enrichWithSpotify({ title, artist, album, genres = [] }) {
  try {
    const out = { genres: [...genres] }
    const found = {}

    if (album && artist) {
      const albums = await spSearchAlbums(`${artist} ${album}`)
      const al = albums[0] || null
      if (al) {
        found.releaseMbid = al.mbid
        out.albumYear = al.year
        if (al.image) {
          const data = await fetchSpotifyImage(al.image)
          if (data) out.cover = { data, contentType: 'image/jpeg' }
        }
        if (al.artist?.mbid) {
          const ar = await spArtistDetail(al.artist.mbid)
          if (ar) {
            found.artistMbid = ar.id
            out.artistGenres = [...new Set(ar.genres || [])].slice(0, 12)
            try {
              const related = await spArtistRelated(ar.id)
              if (related.length) out.similarArtists = related.map((r) => r.name).slice(0, 10)
            } catch { /* similar artists are best-effort */ }
          }
        }
      }
    }

    if (title && artist) {
      const tracks = await spSearchTracks(`${artist} ${title}`)
      const t = tracks[0] || null
      if (t) {
        found.recordingMbid = t.mbid
        if (t.album?.mbid) {
          found.releaseMbid = found.releaseMbid || t.album.mbid
          out.albumYear = out.albumYear || t.album.year
          if (!out.cover && t.album.image) {
            const data = await fetchSpotifyImage(t.album.image)
            if (data) out.cover = { data, contentType: 'image/jpeg' }
          }
        }
      }
    }

    return {
      mbid: found.recordingMbid || null,
      releaseMbid: found.releaseMbid || null,
      artistMbid: found.artistMbid || null,
      albumYear: out.albumYear || null,
      genres: [...new Set(out.genres)].slice(0, 12),
      artistGenres: out.artistGenres || [],
      similarArtists: out.similarArtists || [],
      cover: out.cover || null
    }
  } catch {
    return null
  }
}
