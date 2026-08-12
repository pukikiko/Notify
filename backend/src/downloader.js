import fs from 'node:fs'
import path from 'node:path'
import { db, now, safeJson } from './db.js'
import { ORIGINAL_DIR, ART_DIR, config } from './config.js'
import { soulseek, synthesizeMockTrack, isMockMode } from './soulseek.js'
import { youtubeEnabled, soundcloudEnabled, webSourceEnabled, searchYtMusic, searchSoundCloud, downloadWeb } from './web.js'
import { isSafeHttpUrl } from './safety.js'
import { extractFileMetadata, extractEmbeddedCover, enrichWithSpotify, saveTrackCover, generateAlbumCover } from './metadata.js'
import { spotifyConfigured } from './spotify.js'

const POLL_MS = 2000
let pollTimer = null
let polling = false
// download row id → timestamp when a "Completed, Succeeded" transfer was first
// seen without its file on disk; used to bail on transfers that claim success
// but whose file never appears
const missingFileSince = new Map()

/* ------------------------------------------------------------------ */
/* filename heuristics                                                 */
/* ------------------------------------------------------------------ */

export function parseFilename(filename) {
  const base = path.basename(filename, path.extname(filename))
  const parts = base.split(' - ').map((s) => s.trim()).filter(Boolean)
  let artist = 'Unknown Artist'
  let album = null
  let title = base
  if (parts.length >= 3) {
    artist = parts[0]
    album = parts[1]
    title = parts[2]
  } else if (parts.length === 2) {
    artist = parts[0]
    title = parts[1]
  }
  title = title.replace(/^\d+\s*/, '')
  const format = path.extname(filename).replace('.', '').toLowerCase() || 'flac'
  return { artist, album, title, format }
}

/* ------------------------------------------------------------------ */
/* artist/album upserts                                                */
/* ------------------------------------------------------------------ */

export function upsertArtist(name, { mbid = null, genres = [], image = null } = {}) {
  let row = db.prepare('SELECT * FROM artists WHERE name = ?').get(name)
  if (!row) {
    db.prepare('INSERT INTO artists (name, mbid, genres, image, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(name, mbid, JSON.stringify(genres), image, now())
    row = db.prepare('SELECT * FROM artists WHERE name = ?').get(name)
  } else if (mbid && !row.mbid) {
    db.prepare('UPDATE artists SET mbid = ? WHERE id = ?').run(mbid, row.id)
  }
  return row
}

export function upsertAlbum(title, artistId, { mbid = null, year = null, image = null, genres = [] } = {}) {
  if (!title) return null
  let row = db.prepare('SELECT * FROM albums WHERE title = ? AND artist_id = ?').get(title, artistId)
  if (!row) {
    db.prepare('INSERT INTO albums (title, artist_id, mbid, year, image, genres, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(title, artistId, mbid, year, image, JSON.stringify(genres), now())
    row = db.prepare('SELECT * FROM albums WHERE title = ? AND artist_id = ?').get(title, artistId)
  } else if ((mbid && !row.mbid) || (year && !row.year) || (image && !row.image)) {
    db.prepare('UPDATE albums SET mbid = COALESCE(?, mbid), year = COALESCE(?, year), image = COALESCE(?, image) WHERE id = ?')
      .run(mbid || null, year || null, image || null, row.id)
    row = db.prepare('SELECT * FROM albums WHERE title = ? AND artist_id = ?').get(title, artistId)
  }
  return row
}

/* ------------------------------------------------------------------ */
/* ingest                                                              */
/* ------------------------------------------------------------------ */

async function ingestFile(trackId, filePath, metaOverride = {}) {
  const meta = await extractFileMetadata(filePath)
  if (metaOverride.title) meta.title = metaOverride.title
  if (metaOverride.artist) meta.artist = metaOverride.artist
  if (metaOverride.album) meta.album = metaOverride.album
  if (metaOverride.trackNo != null) meta.trackNo = metaOverride.trackNo
  const artistRow = upsertArtist(meta.artist)
  const albumRow = meta.album ? upsertAlbum(meta.album, artistRow.id) : null

  const finalPath = path.join(ORIGINAL_DIR, `${trackId}.${meta.sourceFormat}`)
  if (path.resolve(filePath) !== path.resolve(finalPath)) {
    try {
      fs.renameSync(filePath, finalPath)
    } catch {
      fs.copyFileSync(filePath, finalPath)
      fs.unlinkSync(filePath)
    }
  }

  db.prepare(`
    UPDATE tracks SET
      title = ?, artist_id = ?, album_id = ?, track_no = ?, disc_no = ?,
      duration = ?, bitrate = ?, source_format = ?, size = ?, genres = ?,
      source_path = ?, art_path = COALESCE(?, art_path), status = 'available'
    WHERE id = ?
  `).run(
    meta.title, artistRow.id, albumRow?.id ?? null,
    meta.trackNo || null, meta.discNo || null,
    meta.duration, meta.bitrate, meta.sourceFormat, meta.size,
    JSON.stringify(meta.genres.slice(0, 8)),
    finalPath, meta.coverPath || null,
    trackId
  )

  db.prepare("UPDATE downloads SET status = 'complete', completed_at = ? WHERE track_id = ?")
    .run(now(), trackId)

  enrichInBackground(trackId, meta, artistRow, albumRow)
}

async function enrichInBackground(trackId, meta, artistRow, albumRow) {
  try {
    const enriched = await enrichWithSpotify({
      title: meta.title,
      artist: meta.artist,
      album: meta.album,
      genres: meta.genres
    })
    if (!enriched) return
    const updates = []
    const params = []
    if (enriched.mbid && !db.prepare('SELECT mbid FROM tracks WHERE id = ?').get(trackId).mbid) {
      updates.push('mbid = ?')
      params.push(enriched.mbid)
    }
    if (enriched.genres.length) {
      updates.push('genres = ?')
      params.push(JSON.stringify([...new Set([...meta.genres, ...enriched.genres])].slice(0, 8)))
    }
    if (updates.length) {
      params.push(trackId)
      db.prepare(`UPDATE tracks SET ${updates.join(', ')} WHERE id = ?`).run(...params)
    }
    if (enriched.cover) {
      const p = await saveTrackCover(trackId, enriched.cover.data, enriched.cover.contentType)
      db.prepare('UPDATE tracks SET art_path = ? WHERE id = ?').run(p, trackId)
      // The album should share the enriched cover too, so the album card/page
      // and every track in it show the same artwork.
      if (albumRow && (!albumRow.image || albumRow.image.startsWith('/api/art/album/'))) {
        db.prepare('UPDATE albums SET image = ? WHERE id = ?').run(`/api/art/${trackId}`, albumRow.id)
      }
    }
    if (enriched.artistMbid || enriched.artistGenres?.length || enriched.similarArtists?.length) {
      const arow = db.prepare('SELECT * FROM artists WHERE id = ?').get(artistRow.id)
      const merged = {
        mbid: enriched.artistMbid || arow.mbid,
        genres: [...new Set([...safeJson(arow.genres, []), ...(enriched.artistGenres || [])])].slice(0, 12),
        similar: [...new Set(enriched.similarArtists || [])].slice(0, 10)
      }
      db.prepare('UPDATE artists SET mbid = ?, genres = ?, similar = ? WHERE id = ?')
        .run(merged.mbid, JSON.stringify(merged.genres), JSON.stringify(merged.similar), artistRow.id)
    }
    if (albumRow && enriched.albumYear) {
      db.prepare('UPDATE albums SET year = COALESCE(?, year) WHERE id = ?').run(enriched.albumYear, albumRow.id)
    }
  } catch {
    /* enrichment is best-effort */
  }
}

/* ------------------------------------------------------------------ */
/* download lifecycle                                                  */
/* ------------------------------------------------------------------ */

export function enqueueDownload({ userId, provider = 'soulseek', username, filename, size = 0, duration = 0, format = 'flac', artist = null, album = null, title = null, mbid = null, trackNo = null, image = null, ref = null, alternates = [] }) {
  if (!filename || typeof filename !== 'string') throw new Error('filename is required')
  const parsed = parseFilename(filename)
  const finalTitle = title || parsed.title
  const finalArtist = artist || parsed.artist
  const finalAlbum = album || parsed.album

  let artistId = null
  let albumId = null
  if (finalArtist && finalArtist !== 'Unknown Artist') {
    artistId = upsertArtist(finalArtist).id
    if (finalAlbum) albumId = upsertAlbum(finalAlbum, artistId, { image: isSafeHttpUrl(image) ? image : null }).id
  }

  const trx = db.prepare(`
    INSERT INTO tracks (title, artist_id, album_id, track_no, mbid, duration, source_format, size, status, source, username, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'downloading', ?, ?, ?)
  `)
  const info = trx.run(finalTitle, artistId, albumId, trackNo || null, mbid || null, duration, format, size, provider, username || null, now())
  const trackId = Number(info.lastInsertRowid)
  db.prepare(`
    INSERT INTO downloads (user_id, track_id, username, filename, size, provider, ref, sources, status, added_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)
  `).run(userId, trackId, username || null, filename, size, provider, ref && isSafeHttpUrl(ref) ? ref : null, JSON.stringify(alternates || []), now())

  if (isSafeHttpUrl(image)) {
    fetchRemoteCover(trackId, image)
  }

  if (provider !== 'soulseek') {
    // Non-soulseek sources (e.g. youtube via yt-dlp) download themselves in
    // the poll loop — nothing to queue with the soulseek daemon.
    return trackId
  }

  try {
    soulseek.download({ username, filename, size })
      // Scope to this source: the transfer may have already failed and
      // fallbackFromSoulseekFailure advanced the row to a different
      // candidate, which this late completion must not clobber.
      .then(() => db.prepare("UPDATE downloads SET status = 'downloading' WHERE track_id = ? AND username = ? AND filename = ?").run(trackId, username, filename))
      .catch((err) => {
        console.error('[downloader] failed to queue', filename, err.message)
        fallbackFromSoulseekFailure(trackId, { username, filename })
      })
  } catch (err) {
    console.error('[downloader] failed to queue', filename, err.message)
    fallbackFromSoulseekFailure(trackId, { username, filename })
  }
  return trackId
}

async function fetchRemoteCover(trackId, url) {
  try {
    if (!isSafeHttpUrl(url)) return
    const existing = db.prepare('SELECT art_path FROM tracks WHERE id = ?').get(trackId)
    if (existing?.art_path) return
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return
    const buf = Buffer.from(await res.arrayBuffer())
    const p = await saveTrackCover(trackId, buf, res.headers.get('content-type') || 'image/jpeg')
    db.prepare('UPDATE tracks SET art_path = ? WHERE id = ? AND art_path IS NULL').run(p, trackId)
  } catch {
    /* cover is best-effort */
  }
}

/* ------------------------------------------------------------------ */
/* deduplication: reuse an already-cached download                     */
/* ------------------------------------------------------------------ */

export function findExistingTrack({ mbid, artist, title }) {
  if (mbid) {
    const row = db.prepare("SELECT * FROM tracks WHERE mbid = ? AND status = 'available' ORDER BY id DESC LIMIT 1").get(mbid)
    if (row) return row
  }
  if (artist && title) {
    const row = db.prepare(`
      SELECT t.* FROM tracks t
      JOIN artists ar ON ar.id = t.artist_id
      WHERE ar.name = ? AND t.title = ? AND t.status = 'available'
      ORDER BY t.id DESC LIMIT 1
    `).get(artist, title)
    if (row) return row
  }
  return null
}

/** Like findExistingTrack but also reuses tracks whose download is already
    in flight (status 'downloading'). Used when the player resolves the same
    song twice (user click + background prefetch) so we don't start a
    duplicate Soulseek/yt-dlp download — the caller just waits on the shared
    row and auto-plays when it flips to available. */
export function findInFlightTrack({ mbid, artist, title }) {
  if (mbid) {
    const row = db.prepare("SELECT * FROM tracks WHERE mbid = ? AND status IN ('available','downloading') ORDER BY id DESC LIMIT 1").get(mbid)
    if (row) return row
  }
  if (artist && title) {
    const row = db.prepare(`
      SELECT t.* FROM tracks t
      JOIN artists ar ON ar.id = t.artist_id
      WHERE ar.name = ? AND t.title = ? AND t.status IN ('available','downloading')
      ORDER BY t.id DESC LIMIT 1
    `).get(artist, title)
    if (row) return row
  }
  return null
}

export function findExistingAlbum({ artist, album }) {
  if (!artist || !album) return null
  const row = db.prepare(`
    SELECT al.* FROM albums al
    JOIN artists ar ON ar.id = al.artist_id
    WHERE al.title = ? AND ar.name = ?
    LIMIT 1
  `).get(album, artist)
  if (!row) return null
  const tracks = db.prepare("SELECT * FROM tracks WHERE album_id = ? AND status = 'available' ORDER BY track_no, id").all(row.id)
  return tracks.length ? tracks : null
}

/* ------------------------------------------------------------------ */
/* multi-source failover                                               */
/* ------------------------------------------------------------------ */

function trackNames(trackId) {
  return db.prepare(`
    SELECT t.id, t.title, t.track_no, t.disc_no,
           ar.name AS artist, al.title AS album
    FROM tracks t
    LEFT JOIN artists ar ON ar.id = t.artist_id
    LEFT JOIN albums al ON al.id = t.album_id
    WHERE t.id = ?
  `).get(trackId)
}

function markFailed(trackId) {
  db.prepare("UPDATE tracks SET status = 'failed' WHERE id = ? AND status != 'available'").run(trackId)
  db.prepare("UPDATE downloads SET status = 'failed' WHERE track_id = ? AND status != 'complete'").run(trackId)
}

/** A Soulseek source was unobtainable. Retry the next-best Soulseek
    candidate first (fastest peer + smallest file, then the next best match);
    only once every stored candidate has been tried do we fall back to the web
    providers (YouTube Music first, then SoundCloud). */
export async function fallbackFromSoulseekFailure(trackId, { username, filename } = {}) {
  const download = db.prepare("SELECT * FROM downloads WHERE track_id = ? AND status != 'complete' ORDER BY id DESC LIMIT 1").get(trackId)
  if (download && download.provider === 'soulseek') {
    const sources = safeJson(download.sources, [])
    if (sources.length) {
      const next = sources.shift()
      db.prepare(`
        UPDATE downloads SET username = ?, filename = ?, size = ?, ref = NULL,
          provider = 'soulseek', status = 'queued', sources = ?, added_at = ?
        WHERE id = ?
      `).run(next.username, next.filename, next.size, JSON.stringify(sources), now(), download.id)
      db.prepare("UPDATE tracks SET status = 'downloading', source = 'soulseek' WHERE id = ?").run(trackId)
      const label = filename || trackNames(trackId)?.title || `track ${trackId}`
      console.log(`[downloader] soulseek source failed on ${label}, trying next candidate: ${next.username} — ${next.filename}`)
      try {
        await soulseek.download({ username: next.username, filename: next.filename, size: next.size })
      } catch (err) {
        console.error('[downloader] failed to queue next soulseek source', next.filename, err.message)
        return fallbackFromSoulseekFailure(trackId, { username: next.username, filename: next.filename })
      }
      return
    }
  }
  if (!webSourceEnabled()) {
    markFailed(trackId)
    return
  }
  const names = trackNames(trackId)
  if (!names) return
  let hit = null
  if (youtubeEnabled()) {
    try {
      hit = await searchYtMusic({ artist: names.artist, album: names.album, title: names.title })
    } catch (err) {
      console.error('[downloader] youtube music search failed', err.message)
    }
  }
  if (!hit && soundcloudEnabled()) {
    try {
      hit = await searchSoundCloud({ artist: names.artist, album: names.album, title: names.title })
    } catch (err) {
      console.error('[downloader] soundcloud search failed', err.message)
    }
  }
  if (!hit) {
    markFailed(trackId)
    return
  }
  const provider = hit.provider
  const query = [names.artist, names.title].filter(Boolean).join(' - ')
  db.prepare(`
    UPDATE downloads SET provider = ?, ref = ?, username = ?, filename = ?, status = 'queued'
    WHERE track_id = ? AND status != 'complete'
  `).run(provider, hit.url, provider, query, trackId)
  db.prepare("UPDATE tracks SET source = ? WHERE id = ? AND status = 'downloading'").run(provider, trackId)
  console.log(`[downloader] soulseek miss on ${filename || names.title} → ${provider} fallback: ${hit.title}`)
}

/** Download a queued web source (YouTube Music / SoundCloud) via yt-dlp,
    then ingest it into the cache. */
async function processWebDownload(d) {
  const names = trackNames(d.track_id)
  if (!names || !d.ref) {
    markFailed(d.track_id)
    return
  }
  db.prepare("UPDATE downloads SET status = 'downloading' WHERE id = ?").run(d.id)
  const outputBase = path.join(ORIGINAL_DIR, `web-${d.track_id}`)
  try {
    const filePath = await downloadWeb(d.ref, outputBase)
    await ingestFile(d.track_id, filePath, {
      title: names.title,
      artist: names.artist && names.artist !== 'Unknown Artist' ? names.artist : null,
      album: names.album || null,
      trackNo: names.track_no || null
    })
  } catch (err) {
    console.error('[downloader] web ingest failed', err.message)
    markFailed(d.track_id)
  } finally {
    for (const name of fs.readdirSync(ORIGINAL_DIR)) {
      if (name.startsWith(`web-${d.track_id}.`)) {
        try { fs.unlinkSync(path.join(ORIGINAL_DIR, name)) } catch { /* ignore */ }
      }
    }
  }
}

function pendingDownloads() {
  return db.prepare(`
    SELECT d.*, t.status AS track_status FROM downloads d
    JOIN tracks t ON t.id = d.track_id
    WHERE d.status IN ('queued', 'downloading')
  `).all()
}

async function poll() {
  if (polling) return
  polling = true
  try {
    const pending = pendingDownloads()
    if (!pending.length) return

    // Web sources (YouTube Music / SoundCloud via yt-dlp): kick off the
    // download. The row is flipped to 'downloading' synchronously, so the
    // next tick won't double-process it.
    for (const d of pending) {
      if (d.provider !== 'soulseek' && d.status === 'queued') {
        processWebDownload(d).catch((err) => {
          console.error('[downloader] web download failed', err.message)
          markFailed(d.track_id)
        })
      }
    }

    if (isMockMode()) {
      for (const d of pending) {
        if (d.provider !== 'soulseek') continue
        if (d.status === 'queued') {
          db.prepare("UPDATE downloads SET status = 'downloading' WHERE id = ?").run(d.id)
        }
        if (now() - d.added_at < config.mock.downloadDelayMs) continue
        const p = parseFilename(d.filename)
        const outPath = path.join(ORIGINAL_DIR, `tmp-${d.track_id}.flac`)
        try {
          await synthesizeMockTrack({
            trackId: d.track_id,
            title: p.title,
            artist: p.artist,
            album: p.album || 'Unknown',
            duration: config.mock.duration,
            format: 'flac',
            outputPath: outPath
          })
          await ingestFile(d.track_id, outPath)
        } catch (err) {
          console.error('[downloader] mock ingest failed', err.message)
          db.prepare("UPDATE tracks SET status = 'failed' WHERE id = ?").run(d.track_id)
          db.prepare("UPDATE downloads SET status = 'failed' WHERE id = ?").run(d.id)
        }
      }
      return
    }

    // slskd mode: match transfers
    let transfers = []
    try {
      transfers = await soulseek.downloads()
    } catch {
      return
    }

    // slskd reports transfer state as a comma-separated pair, e.g.
    // "Completed, Succeeded", "Completed, Rejected", "Completed, TimedOut",
    // "Completed, Cancelled". A transfer is a failure if ANY qualifier says
    // so — a "Completed" prefix alone must never be read as success, or a
    // rejected/timed-out download would be treated as finished and we'd wait
    // forever for a file that never appears.
    const isFailure = (s) => /reject|cancel|timeout|timed|fail|missing|error|insufficient|denied/i.test(s || '')
    const isSuccess = (s) => {
      const state = s || ''
      if (isFailure(state)) return false
      return /complete|succeed|finish/i.test(state)
    }
    const transferStarted = (m) => {
      if (!m) return false
      if (m.bytesReceived > 0) return true
      return /transfer|progress|initial/i.test(m.state || '')
    }

    for (const d of pending) {
      if (d.provider !== 'soulseek') continue
      // slskd keeps every historical transfer, so a re-enqueued source can
      // have both a stale (e.g. previously rejected) and a fresh transfer with
      // the same username/filename. Always react to the most recently enqueued
      // one, not whatever happens to come first in the list.
      const matches = transfers.filter((t) => t.username === d.username && t.filename === d.filename)
      const match = matches.reduce((a, b) => (String(b.enqueuedAt || '') > String(a.enqueuedAt || '') ? b : a), matches[0])
      if (match && isFailure(match.state)) {
        console.warn('[downloader] soulseek transfer failed, trying next source', d.filename, match.state)
        fallbackFromSoulseekFailure(d.track_id, { username: d.username, filename: d.filename })
          .catch(() => markFailed(d.track_id))
      } else if (match && isSuccess(match.state)) {
        const filePath = findDownloadedFile(d.filename)
        if (filePath) {
          try {
            await ingestFile(d.track_id, filePath)
            missingFileSince.delete(d.id)
            continue
          } catch (err) {
            // transfer completed but the file is corrupt/unreadable — treat it
            // like any other failed source and try the next-best candidate
            console.error('[downloader] slskd ingest failed, trying next source', err.message)
            fallbackFromSoulseekFailure(d.track_id, { username: d.username, filename: d.filename })
              .catch(() => markFailed(d.track_id))
            continue
          }
        }
        // Transfer reports complete but the file hasn't appeared yet (slskd
        // moves it into the cache immediately after finishing, so this should
        // only last a tick or two). If it stays missing the source is no good
        // — stop waiting and try the next candidate.
        const since = missingFileSince.get(d.id) || now()
        missingFileSince.set(d.id, since)
        if (now() - since > config.slskd.completeMissingTimeoutMs) {
          missingFileSince.delete(d.id)
          console.warn('[downloader] soulseek transfer reported complete but file never appeared, trying next source', d.filename, match.state)
          fallbackFromSoulseekFailure(d.track_id, { username: d.username, filename: d.filename })
            .catch(() => markFailed(d.track_id))
        }
      } else if (now() - d.added_at >= config.slskd.downloadStartTimeoutMs && !transferStarted(match)) {
        // the peer never started the transfer (still queued, or the transfer
        // never appeared) — try the next-best Soulseek candidate, and only
        // fall back to yt-dlp once those are exhausted
        console.warn('[downloader] soulseek transfer not started, trying next source', d.filename, match?.state || 'no transfer')
        fallbackFromSoulseekFailure(d.track_id, { username: d.username, filename: d.filename })
          .catch(() => markFailed(d.track_id))
      }
    }
  } finally {
    polling = false
  }
}

function findDownloadedFile(filename) {
  const base = filename.split(/[\\/]/).pop()
  const found = []
  const walk = (dir) => {
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name === base) found.push(p)
    }
  }
  walk(ORIGINAL_DIR)
  walk(path.join(ORIGINAL_DIR, '..', 'incomplete'))
  if (!found.length) return null
  // prefer the one in downloads (complete), else the largest
  return found.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0]
}

export function startDownloader() {
  if (pollTimer) return
  pollTimer = setInterval(poll, POLL_MS)
  poll()
  backfillArtwork()
}

/* ------------------------------------------------------------------ */
/* artwork backfill: give every cached track/album/artist a cover      */
/* ------------------------------------------------------------------ */

/**
 * Runs once at startup so library/home surfaces always have artwork, and all
 * surfaces agree on the same image for a given track/album/artist:
 *  - tracks with a cached file but no stored art get their embedded cover
 *    extracted and remembered
 *  - albums/artists with no image inherit the first available track's art
 *  - remaining artless tracks are enriched with Spotify (real covers)
 *  - albums that still have nothing get a deterministic generated cover so no
 *    surface is ever left blank
 */
export async function backfillArtwork() {
  try {
    const artistName = (t) => t.artist_id ? db.prepare('SELECT name FROM artists WHERE id = ?').get(t.artist_id)?.name || null : null
    const albumTitle = (t) => t.album_id ? db.prepare('SELECT title FROM albums WHERE id = ?').get(t.album_id)?.title || null : null
    const firstTrackArt = (table, idCol) => db.prepare(`
      SELECT id FROM tracks WHERE ${idCol} = ? AND status = 'available'
        AND art_path IS NOT NULL AND art_path != ''
      ORDER BY id LIMIT 1
    `)

    // 1. tracks with a cached file but no stored art: extract the embedded cover
    const missingTracks = db.prepare("SELECT * FROM tracks WHERE status = 'available' AND (art_path IS NULL OR art_path = '')").all()
    for (const t of missingTracks) {
      if (!t.source_path || !fs.existsSync(t.source_path)) continue
      const cover = await extractEmbeddedCover(t.source_path)
      if (!cover) continue
      try {
        const p = await saveTrackCover(t.id, cover.data, cover.contentType)
        db.prepare('UPDATE tracks SET art_path = ? WHERE id = ?').run(p, t.id)
      } catch { /* ignore */ }
    }

    // 2. albums with no image inherit the first available track's art
    for (const al of db.prepare("SELECT * FROM albums WHERE image IS NULL OR image = ''").all()) {
      const row = firstTrackArt('tracks', 'album_id').get(al.id)
      if (row) db.prepare('UPDATE albums SET image = ? WHERE id = ?').run(`/api/art/${row.id}`, al.id)
    }

    // 3. enrich any track that still has no art via Spotify (real covers for
    //    real artists), then let its album inherit the found cover
    const stillArtless = db.prepare("SELECT * FROM tracks WHERE status = 'available' AND (art_path IS NULL OR art_path = '')").all()
    if (spotifyConfigured()) {
      for (const t of stillArtless) {
        try {
          const enriched = await enrichWithSpotify({
            title: t.title,
            artist: artistName(t),
            album: albumTitle(t),
            genres: safeJson(t.genres, [])
          })
          if (enriched?.cover) {
            const p = await saveTrackCover(t.id, enriched.cover.data, enriched.cover.contentType)
            db.prepare('UPDATE tracks SET art_path = ? WHERE id = ?').run(p, t.id)
            if (t.album_id) {
              const al = db.prepare('SELECT * FROM albums WHERE id = ?').get(t.album_id)
              if (al && (!al.image || al.image.startsWith('/api/art/album/'))) {
                db.prepare('UPDATE albums SET image = ? WHERE id = ?').run(`/api/art/${t.id}`, al.id)
              }
            }
          }
        } catch { /* best-effort */ }
      }
    }

    // 4. any album still without art gets a deterministic generated cover, so
    //    nothing in the library is ever left blank
    for (const al of db.prepare(`
      SELECT al.*, ar.name AS artist_name FROM albums al
      LEFT JOIN artists ar ON ar.id = al.artist_id
      WHERE (al.image IS NULL OR al.image = '')
        AND (SELECT COUNT(*) FROM tracks t WHERE t.album_id = al.id AND t.status = 'available') > 0
    `).all()) {
      const p = path.join(ART_DIR, `album-${al.id}.png`)
      if (!fs.existsSync(p)) {
        try { fs.writeFileSync(p, generateAlbumCover(`${al.artist_name || ''} ${al.title}`)) } catch { /* ignore */ }
      }
      if (fs.existsSync(p)) {
        db.prepare('UPDATE albums SET image = ? WHERE id = ?').run(`/api/art/album/${al.id}`, al.id)
      }
    }

    // 5. artists still without art inherit the first available track's art,
    //    falling back to the artist's first album cover
    for (const ar of db.prepare("SELECT * FROM artists WHERE image IS NULL OR image = ''").all()) {
      const row = firstTrackArt('tracks', 'artist_id').get(ar.id)
      if (row) {
        db.prepare('UPDATE artists SET image = ? WHERE id = ?').run(`/api/art/${row.id}`, ar.id)
      } else {
        const al = db.prepare("SELECT image FROM albums WHERE artist_id = ? AND image IS NOT NULL AND image != '' LIMIT 1").get(ar.id)
        if (al?.image) db.prepare('UPDATE artists SET image = ? WHERE id = ?').run(al.image, ar.id)
      }
    }
  } catch (err) {
    console.error('[downloader] art backfill failed', err.message)
  }
}

export function stopDownloader() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}
