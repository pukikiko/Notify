import { config } from './config.js'
import { soulseek, isMockMode } from './soulseek.js'
import { parseFilename, enqueueDownload, findExistingTrack, findInFlightTrack, findExistingAlbum } from './downloader.js'
import { youtubeEnabled, soundcloudEnabled, webSourceEnabled, searchYtMusic, searchSoundCloud, searchYtMusicTracks, searchSoundCloudTracks } from './web.js'
import { db, getTrackRow } from './db.js'
import {
  ratioVariants, verifyFiletype, albumTrackNum, albumMatch, buildQuery,
  baseExtensions, allowedFilesOnly, isIgnoredUser, fileDir, joinPath, artistScore
} from './soularr.js'
import {
  spotifyConfigured, pickImage, albumEntity, playlistEntity, trackEntity, userEntity,
  spSearchArtists, spSearchAlbums, spSearchTracks, spSearchPlaylists,
  spArtistDetail, spArtistTopTracks, spArtistAlbums,
  spAlbumDetail, spAlbumTracks, spPlaylistDetail, spPlaylistTracks, spUserPlaylists
} from './spotify.js'
import { wikiArtist } from './wikipedia.js'

function norm(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/* ------------------------------------------------------------------ */
/* tiny cache (keeps repeated searches fast)                           */
/* ------------------------------------------------------------------ */

const cache = new Map()
async function cached(key, ttl, fn) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.t < ttl) return hit.v
  let v
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      v = await fn()
      break
    } catch (err) {
      if (attempt === 1) throw err
      await new Promise((r) => setTimeout(r, 900))
    }
  }
  cache.set(key, { t: Date.now(), v })
  if (cache.size > 200) {
    const first = cache.keys().next().value
    cache.delete(first)
  }
  return v
}

/* ------------------------------------------------------------------ */
/* Spotify lookups (external metadata)                                 */
/* ------------------------------------------------------------------ */

const spArtists = (q) => cached(`sp-artist:${q}`, 60000, () => spSearchArtists(q))
const spAlbums = (q) => cached(`sp-album:${q}`, 60000, () => spSearchAlbums(q))
const spTracks = (q) => cached(`sp-track:${q}`, 60000, () => spSearchTracks(q))
const spPlaylists = (q) => cached(`sp-playlist:${q}`, 60000, () => spSearchPlaylists(q))
const spUserPlaylistsCached = (id) => cached(`sp-userplaylists:${id}`, 60000, () => spUserPlaylists(id))
const spTopTracks = (id, limit = 20) => cached(`sp-top:${id}:${limit}`, 60000, () => spArtistTopTracks(id, limit))
const spArtistAlbumsCached = (id, limit = 20) => cached(`sp-artalbums:${id}:${limit}`, 60000, () => spArtistAlbums(id, limit))
const spAlbumTracksCached = (id) => cached(`sp-albumtracks:${id}`, 60000, () => spAlbumTracks(id))

/* ------------------------------------------------------------------ */
/* entity shaping                                                      */
/* ------------------------------------------------------------------ */

/** Prefer full albums over singles/EPs, newer releases, and artwork. */
function albumScore(a) {
  let s = 0
  if (a.albumType === 'album') s += 40
  else if (a.albumType === 'ep') s += 20
  if (a.year) s += 15
  s += Math.min(30, (a.trackCount || 0) * 3)
  if (a.image) s += 10
  return s
}

/* ------------------------------------------------------------------ */
/* library linking: expose the local DB id so the UI can deep-link     */
/* ------------------------------------------------------------------ */

export function matchScore(q, name) {
  const nq = norm(q)
  const nn = norm(name)
  if (!nq || !nn) return 0
  if (nn === nq) return 100
  if (nn.startsWith(nq) && nq.length >= 3) return 80
  if (nn.includes(nq) && nq.length >= 4) return 70
  if (nq.includes(nn) && nn.length >= 4) return 60
  return 0
}

/* ------------------------------------------------------------------ */
/* Spotify "did it actually have it?" relevance gate                   */
/* ------------------------------------------------------------------ */

/** Words that carry no identifying signal for a track search. */
const QUERY_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'for', 'with', 'without', 'on', 'in',
  'at', 'by', 'to', 'from', 'feat', 'ft', 'vs', 'remix', 'mix', 'edit',
  'version', 'official', 'audio', 'video', 'lyrics', 'song', 'songs',
  'music', 'album', 'artist', 'live', 'single'
])

function significantTokens(q) {
  return (q || '').toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !QUERY_STOPWORDS.has(t))
}

/** "Version/style" tags whose content lives mostly on YouTube/SoundCloud —
    nightcore, remixes, covers, mashups etc. A query containing one of these
    is asking for a specific remix/version that Spotify rarely hosts (it may
    only have the scattered-token original), so web results are always wanted. */
const VERSION_TAGS = new Set([
  'nightcore', 'remix', 'mashup', 'karaoke', 'instrumental', 'acoustic',
  'rework', 'bootleg', 'reprise', 'orchestral', 'symphonic', 'cover',
  'slowed', 'sped', 'reverb'
])

function queryHasVersionTag(q) {
  return significantTokens(q).some((t) => VERSION_TAGS.has(t))
}

/** Fraction of a query's significant tokens present in a result's haystack. */
export function tokenCoverage(q, haystack) {
  const tokens = significantTokens(q)
  if (!tokens.length) return 1
  const nq = norm(q)
  const nh = norm(haystack)
  if (nh === nq) return 1
  if (nh.includes(nq)) return 1
  const hits = tokens.filter((t) => nh.includes(t)).length
  return hits / tokens.length
}

/**
 * True when Spotify's top results look like fuzzy filler rather than a real
 * match for the query — the case where "Pop Culture" by some random artist
 * surfaces for "madeon pop culture". Checks the best coverage of the query's
 * significant tokens across the top tracks/albums/artists/playlists. Queries
 * that are a single token (mostly genre words like "synthwave") are never
 * treated as a miss, and a query that matches an artist's Spotify genre
 * phrase (e.g. "indie folk") is a genre browse, not a miss.
 */
export function isSpotifyMiss(q, out) {
  const tokens = significantTokens(q)
  if (tokens.length < 2) return false

  // genre browse guard: "post rock", "indie folk", "dream pop", ... are
  // legit Spotify queries even though the words rarely appear in titles
  const genreHay = norm((out.artists || []).flatMap((a) => a.genres || []).join(' '))
  if (genreHay && genreHay.includes(norm(q))) return false

  let best = 0
  for (const t of out.tracks.slice(0, 10)) {
    best = Math.max(best, tokenCoverage(q, `${t.title} ${t.artist?.name || ''} ${t.album?.title || ''}`))
  }
  for (const al of out.albums.slice(0, 6)) {
    best = Math.max(best, tokenCoverage(q, `${al.title} ${al.artist?.name || ''}`))
  }
  for (const a of out.artists.slice(0, 6)) {
    best = Math.max(best, tokenCoverage(q, a.name))
  }
  for (const p of out.playlists.slice(0, 4)) {
    best = Math.max(best, tokenCoverage(q, p.name))
  }
  return best < config.discover.coverageMin
}

export function libraryArtistId({ name, mbid } = {}) {
  if (mbid) {
    const row = db.prepare('SELECT id FROM artists WHERE mbid = ?').get(mbid)
    if (row) return row.id
  }
  if (name) {
    const row = db.prepare('SELECT id FROM artists WHERE name = ? COLLATE NOCASE').get(name)
    if (row) return row.id
  }
  return null
}

/** Attach a Wikipedia bio + lead image to an artist object (cached). */
export async function enrichArtist(artist) {
  if (!artist || !artist.name || artist.bio) return artist
  const wiki = await wikiArtist(artist.name)
  return wiki ? { ...artist, bio: wiki.extract, wikiImage: wiki.image } : artist
}

export function libraryAlbumId({ title, artistName, mbid } = {}) {
  if (mbid) {
    const row = db.prepare('SELECT id FROM albums WHERE mbid = ?').get(mbid)
    if (row) return row.id
  }
  if (title && artistName) {
    const row = db.prepare(`
      SELECT al.id FROM albums al
      JOIN artists ar ON ar.id = al.artist_id
      WHERE al.title = ? COLLATE NOCASE AND ar.name = ? COLLATE NOCASE LIMIT 1
    `).get(title, artistName)
    if (row) return row.id
  }
  return null
}

/* Catalog (offline/mock) entities have no external id, so they get a
   page-addressable key instead of an mbid. */
export function catalogArtistKey(name) {
  return `catalog:artist:${name}`
}
export function catalogAlbumKey(artist, album) {
  return `catalog:album:${artist}::${album}`
}

function withLibraryArtist(a) {
  const libId = libraryArtistId(a)
  const href = libId ? `/artist/${libId}` : a.mbid ? `/artist/sp-${a.mbid}` : null
  return {
    ...a,
    libraryId: libId,
    href: href || (a.name ? `/artist/${encodeURIComponent(catalogArtistKey(a.name))}` : null)
  }
}

function withLibraryAlbum(a) {
  const libId = libraryAlbumId({ title: a.title, artistName: a.artist?.name, mbid: a.mbid })
  const href = libId ? `/album/${libId}` : a.mbid ? `/album/sp-${a.mbid}` : null
  return {
    ...a,
    libraryId: libId,
    href: href || (a.title && a.artist?.name ? `/album/${encodeURIComponent(catalogAlbumKey(a.artist.name, a.title))}` : null)
  }
}

/* ------------------------------------------------------------------ */
/* Soulseek source matching (Soularr algorithm)                        */
/* ------------------------------------------------------------------ */

/** Expected download time for a Soulseek candidate, in seconds. A faster
    peer and a smaller file finish sooner; peers that don't advertise a speed
    are assumed modestly fast. slskd reports a peer's upload speed in
    bytes/sec, so the advertised speed is used directly as a byte rate. */
function estimatedDownloadSeconds({ size = 0, uploadSpeed = 0 }) {
  if (size <= 0) return Infinity
  if (uploadSpeed > 0) return size / uploadSpeed
  const kbps = config.soularr.assumedUploadSpeedKbps
  if (!kbps) return Infinity
  return (size * 8) / (kbps * 1000)
}

export async function findBestTrackSource({ artist, album, title }) {
  const query = buildQuery(artist, title)
  // One search serves every quality tier: slskd already filters to complete
  // files, and each file is then scored against the tier it best satisfies.
  let results = []
  try {
    results = await soulseek.search(query, 100)
  } catch {
    return null
  }
  const candidates = []
  for (const user of results) {
    if (isIgnoredUser(user.username)) continue
    for (const file of user.files) {
      let tier = -1
      for (let t = 0; t < config.soularr.allowedFiletypes.length; t++) {
        if (verifyFiletype(file, config.soularr.allowedFiletypes[t])) { tier = t; break }
      }
      if (tier < 0) continue
      // The artist check runs against the whole path — the share directory is
      // usually where the artist appears ("Ninajirachi\...\02 - 1x1.flac" has
      // no artist in the filename itself), so judge the candidate on the full
      // path, not just the basename.
      if (artistScore(`${fileDir(file.filename)} ${file.filename}`.trim(), artist) < config.soularr.minimumArtistScore) continue
      const ext = config.soularr.allowedFiletypes[tier].split(' ')[0]
      const ratio = ratioVariants(`${title}.${ext}`, file.filename, album, config.soularr.minimumMatchRatio)
      if (ratio <= config.soularr.minimumMatchRatio) continue
      candidates.push({
        tier,
        username: user.username,
        filename: file.filename,
        size: file.size,
        length: file.length,
        format: file.format,
        bitrate: file.bitrate,
        ratio,
        time: estimatedDownloadSeconds({ size: file.size, uploadSpeed: user.uploadSpeed })
      })
    }
  }
  if (!candidates.length) return null
  // A single file can satisfy several tiers (e.g. an mp3 at 320kbps matches
  // both 'mp3 320' and 'mp3'); keep only its highest (first) tier.
  const seen = new Set()
  const unique = candidates.filter((c) => {
    const key = `${c.username}::${c.filename}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  // Rank every candidate: the quality tier the file satisfies comes first
  // (lossless tiers before lossy), then expected download time (fastest peer +
  // smallest file), with the best match as tiebreak. The best is queued
  // immediately and the rest are kept as alternates so a failed download can
  // retry the next-best Soulseek source before giving up.
  unique.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier
    if (a.time !== b.time) return a.time - b.time
    if (b.ratio !== a.ratio) return b.ratio - a.ratio
    return a.size - b.size
  })
  const strip = ({ tier, time, ratio, ...source }) => source
  const [best, ...rest] = unique
  return { ...strip(best), alternates: rest.slice(0, config.soularr.maxAlternateSources).map(strip) }
}

export async function findAlbumSource({ artist, album, tracklist }) {
  const query = buildQuery(artist, album)
  const base = baseExtensions()
  const tracks = Array.isArray(tracklist) && tracklist.length
    ? tracklist.map((t) => ({ title: t.title }))
    : null

  // Search once for the album and filter per quality tier below; re-searching
  // for every tier would hit slskd with several identical queries.
  let results = []
  try {
    results = await soulseek.search(query, 100)
  } catch {
    return null
  }

  for (const allowedFiletype of config.soularr.allowedFiletypes) {
    const groups = []
    for (const user of results) {
      if (isIgnoredUser(user.username)) continue
      const byDir = new Map()
      for (const file of user.files) {
        if (!verifyFiletype(file, allowedFiletype)) continue
        const dir = fileDir(file.filename)
        if (!byDir.has(dir)) byDir.set(dir, [])
        byDir.get(dir).push(file)
      }
      for (const [dir, files] of byDir) groups.push({ username: user.username, dir, files })
    }

    let fallbackBest = null
    let fallbackScore = -1
    for (const g of groups) {
      let directory = { files: g.files }
      try {
        directory = await soulseek.browse(g.username, g.dir)
      } catch {
        continue
      }
      if (!directory.files || !directory.files.length) continue

      const haystack = [g.dir, ...directory.files.map((f) => f.filename)].join(' ')
      if (artistScore(haystack, artist) < config.soularr.minimumArtistScore) continue

      if (tracks) {
        const info = albumTrackNum(directory.files, base)
        if (info.count !== tracks.length || !info.filetype) continue
        if (!albumMatch(tracks, directory.files, album, allowedFiletype, config.soularr.minimumMatchRatio)) continue
        return {
          username: g.username,
          fileDir: g.dir,
          files: allowedFilesOnly(directory.files).map((f) => ({ ...f, filename: joinPath(g.dir, f.filename) }))
        }
      }

      const files = allowedFilesOnly(directory.files).filter((f) => {
        const fn = norm(f.filename)
        return (!artist || fn.includes(norm(artist))) && (!album || fn.includes(norm(album)))
      })
      if (files.length > fallbackScore) {
        fallbackScore = files.length
        fallbackBest = {
          username: g.username,
          fileDir: g.dir,
          files: files.map((f) => ({ ...f, filename: joinPath(g.dir, f.filename) }))
        }
      }
    }
    if (fallbackBest) return fallbackBest
  }
  return null
}

function fabricateSource(artist, album, title) {
  const base = [artist, album, title].filter(Boolean).join(' - ')
  return { username: 'mock', filename: `${base}.flac`, size: 0, length: 0, format: 'flac' }
}

/* ------------------------------------------------------------------ */
/* Web fallback sources (YouTube Music, SoundCloud via yt-dlp)         */
/* ------------------------------------------------------------------ */

/** Search the web providers in order (YouTube Music, then SoundCloud) and
    shape the best hit like a Soulseek source. */
export async function findWebTrackSource({ artist, album, title, duration }) {
  const searches = []
  if (youtubeEnabled()) searches.push(searchYtMusic)
  if (soundcloudEnabled()) searches.push(searchSoundCloud)
  for (const search of searches) {
    let hit = null
    const label = search === searchYtMusic ? 'youtube music' : 'soundcloud'
    try {
      hit = await search({ artist, album, title, duration })
    } catch (err) {
      console.warn(`[web] ${label} search failed`, err.message)
      continue
    }
    if (!hit) continue
    return {
      provider: hit.provider,
      username: hit.provider,
      filename: [artist, album, title].filter(Boolean).join(' - '),
      size: 0,
      length: hit.duration || duration || 0,
      format: 'm4a',
      url: hit.url
    }
  }
  return null
}

/* ------------------------------------------------------------------ */
/* catalog fallback (offline mock demo)                                */
/* ------------------------------------------------------------------ */

async function catalogAlbums(artist) {
  const results = await soulseek.search(artist || '', 100)
  const byAlbum = new Map()
  for (const user of results) {
    for (const file of user.files) {
      const p = parseFilename(file.filename)
      if (artist && norm(p.artist) !== norm(artist)) continue
      const key = `${p.artist}::${p.album || 'Unknown'}`
      if (!byAlbum.has(key)) byAlbum.set(key, { artist: p.artist, album: p.album, username: user.username, files: [] })
      byAlbum.get(key).files.push(file)
    }
  }
  return [...byAlbum.values()]
}

/* ------------------------------------------------------------------ */
/* discover search                                                     */
/* ------------------------------------------------------------------ */

async function catalogSearch(q) {
  const results = await soulseek.search(q, 100)
  const byAlbum = new Map()
  const tracks = []
  const artistNames = new Map()
  for (const user of results) {
    for (const file of user.files) {
      const p = parseFilename(file.filename)
      tracks.push({
        kind: 'track',
        id: `catalog-track:${file.filename}`,
        title: p.title,
        artist: { name: p.artist },
        album: p.album ? { title: p.album } : null,
        mbid: null,
        duration: file.length,
        image: null,
        source: { username: user.username, filename: file.filename, size: file.size, duration: file.length, format: file.format }
      })
      if (p.artist && p.artist !== 'Unknown Artist') artistNames.set(p.artist, true)
      const key = `${p.artist}::${p.album || 'Unknown Album'}`
      if (!byAlbum.has(key)) byAlbum.set(key, { artist: p.artist, album: p.album || 'Unknown Album', username: user.username, files: [] })
      byAlbum.get(key).files.push(file)
    }
  }
  return {
    artists: [...artistNames.keys()].map((name) => ({
      kind: 'artist', id: `catalog-artist:${name}`, name, mbid: null, image: null, genres: []
    })),
    albums: [...byAlbum.values()].map((a, i) => ({
      kind: 'album',
      id: `catalog-album:${i}`,
      title: a.album,
      artist: { name: a.artist },
      mbid: null,
      year: null,
      image: null,
      trackCount: a.files.length,
      source: { username: a.username, files: a.files }
    })),
    tracks: tracks.slice(0, 20)
  }
}

function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    Promise.resolve(promise)
      .then((v) => { clearTimeout(timer); resolve(v) })
      .catch(() => { clearTimeout(timer); resolve(fallback) })
  })
}

/** Collapse duplicate album editions into one result each. */
function dedupeReleases(albums) {
  const seen = new Set()
  const out = []
  for (const a of albums) {
    const key = a.mbid
    if (seen.has(key)) continue
    seen.add(key)
    out.push(a)
  }
  return out
}

/** Free-text search of the web fallback providers (YouTube Music, then
    SoundCloud). Only reached when Spotify couldn't find the query. Returns
    several ranked hits per provider so the search page shows a real list of
    playable YouTube Music / SoundCloud results, not just a single best guess. */
async function webTracksSearch(q) {
  const out = []
  const searches = []
  if (youtubeEnabled()) searches.push(['youtube music', searchYtMusicTracks])
  if (soundcloudEnabled()) searches.push(['soundcloud', searchSoundCloudTracks])
  for (const [label, search] of searches) {
    let hits = []
    try {
      hits = await search({ query: q, title: q, minScore: 12 }, 8)
    } catch (err) {
      console.warn(`[discover] ${label} search failed`, err.message)
      continue
    }
    for (const hit of hits) {
      out.push({
        kind: 'track',
        id: `web-track:${hit.provider}:${encodeURIComponent(hit.url)}`,
        title: hit.title,
        artist: { name: hit.artist },
        album: null,
        mbid: null,
        duration: hit.duration,
        image: hit.thumbnail,
        provider: hit.provider,
        source: {
          provider: hit.provider,
          username: hit.provider,
          filename: q,
          duration: hit.duration,
          format: 'm4a',
          url: hit.url
        }
      })
    }
  }
  return out
}

/**
 * Populate { artist, popularTracks, albums } when the query is a known artist.
 * Tries the full query, then shorter suffixes ("currents tame impala" →
 * "tame impala"), and only treats the match as an artist if the artist has
 * enough traction on Spotify (avoids hijacking common song titles that
 * happen to be the name of an obscure band).
 */

/** True when the query's first significant token is itself a known Spotify
    artist (e.g. "madeon" in "madeon pop culture"). When a later suffix also
    matched an artist, the query is "artist + title", not an "album + artist"
    browse — so the suffix hijack must be skipped. */
async function queryStartsWithArtist(q) {
  const first = significantTokens(q)[0]
  if (!first) return false
  try {
    const artists = await spArtists(first)
    return artists.some((a) => matchScore(first, a.name) >= 70)
  } catch {
    return false
  }
}

async function discoverArtistQuery(q) {
  const tokens = q.split(/\s+/).filter(Boolean)
  for (let i = 0; i < tokens.length; i++) {
    const cand = tokens.slice(i).join(' ')

    let best = null
    let bestScore = 0
    try {
      const artists = await spArtists(cand)
      for (const a of artists) {
        const s = matchScore(cand, a.name)
        if (s > bestScore) { bestScore = s; best = a }
      }
    } catch { continue }
    if (!best || bestScore < 70) continue

    // Suffix-match guard: when the query matched an artist via a *suffix*
    // ("madeon pop culture" → artist "Pop Culture"/"Culture"), check whether
    // the query begins with a known artist. If it does ("madeon"), this is
    // an "artist + title" query, not an artist browse — fall through to the
    // general search so the track-level miss gate can run.
    if (i > 0 && await queryStartsWithArtist(q)) return null

    // Popularity gate: an artist with zero/unknown traction shouldn't
    // hijack a song-title query ("let it happen"). Falls through to the
    // general search, which surfaces the actual song recordings.
    let popularity = 0
    try {
      const detail = await spArtistDetail(best.mbid)
      popularity = detail.popularity ?? 0
    } catch { continue }
    if (popularity && popularity < 30) return null

    let popularTracks = []
    try { popularTracks = await spTopTracks(best.mbid, 20) } catch { continue }

    let albums = []
    try {
      albums = dedupeReleases(
        (await spArtistAlbumsCached(best.mbid, 20))
          .filter((a) => a.albumType === 'album' || a.albumType === 'ep')
          .sort((a, b) => albumScore(b) - albumScore(a))
          .slice(0, 10)
      )
    } catch { albums = [] }

    return {
      artist: withLibraryArtist({ ...best, id: `artist:${best.mbid}` }),
      popularTracks: popularTracks.slice(0, 10),
      albums: albums.map(withLibraryAlbum),
      tracks: popularTracks.slice(0, 10)
    }
  }
  return null
}

function dedupeBy(arr, key) {
  const seen = new Set()
  return arr.filter((x) => {
    const k = x[key]
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export async function discoverSearch(q) {
  // In mock/offline mode we must never hit Spotify: it makes the demo slow
  // and returns real-world results that can't be downloaded anyway.
  if (isMockMode()) return mockDiscover(q)

  const EMPTY = { artists: [], albums: [], tracks: [], playlists: [], popularTracks: [], artist: null, fallback: true }
  if (!spotifyConfigured()) {
    return { ...EMPTY, error: 'Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to enable search' }
  }
  // Hard budget so a slow Spotify/Soulseek network can never leave the
  // search hanging — degrade gracefully instead.
  return withTimeout(discoverSearchInner(q), 12000, { ...EMPTY, degraded: true })
}

async function discoverSearchInner(q) {
  const out = { artists: [], albums: [], tracks: [], playlists: [], popularTracks: [], artist: null, fallback: false }

  // If the query is clearly one artist, go artist-first: their popular
  // tracks and top albums are far more relevant than a generic multi-search.
  try {
    const hit = await withTimeout(discoverArtistQuery(q), 8000, null)
    if (hit) {
      Object.assign(out, hit)
      return out
    }
  } catch { /* fall through to general search */ }

  // Every entity search is independent: a slow or failing Spotify type
  // must never wipe out the results of the others (fall back to [] each).
  const [albums, tracks, artists, playlists] = await Promise.all([
    withTimeout(spAlbums(q), 5000, []),
    withTimeout(spTracks(q), 5000, []),
    withTimeout(spArtists(q), 5000, []),
    withTimeout(spPlaylists(q), 5000, [])
  ])
  out.albums = dedupeBy(
    albums.sort((a, b) => albumScore(b) - albumScore(a)),
    'mbid'
  ).slice(0, 20)
  out.tracks = dedupeBy(
    tracks.sort((a, b) => (b.popularity || 0) - (a.popularity || 0)),
    'mbid'
  ).slice(0, 20)
  out.popularTracks = out.tracks
  out.artists = artists.map(withLibraryArtist)
  out.playlists = playlists.slice(0, 12)

  out.albums = out.albums.map(withLibraryAlbum)

  // Spotify's fuzzy search returns *something* for almost any query, so an
  // empty result isn't the only miss: when the top results don't actually
  // cover the query's tokens, treat it as not-found-on-Spotify too and fall
  // back to the Soulseek catalog + the web providers (YouTube Music /
  // SoundCloud) so obscure tracks that aren't on Spotify still surface.
  const spotifyEmpty = !out.artists.length && !out.albums.length && !out.tracks.length && !out.playlists.length
  const spotifyMiss = isSpotifyMiss(q, out)
  const versionSearch = queryHasVersionTag(q)
  if (spotifyEmpty || spotifyMiss || versionSearch) {
    out.degraded = true
    if (spotifyEmpty) console.warn(`[discover] Spotify returned nothing for "${q}" — falling back to catalog + YouTube Music/SoundCloud`)
    else if (spotifyMiss) console.warn(`[discover] Spotify results for "${q}" are a weak match (coverage below ${config.discover.coverageMin}) — adding YouTube Music/SoundCloud`)
    else console.warn(`[discover] "${q}" looks like a remix/version request — including YouTube Music/SoundCloud`)
    const [found, webTracks] = await Promise.all([
      withTimeout(catalogSearch(q), 5000, null),
      withTimeout(webTracksSearch(q), 12000, [])
    ])
    if (found && spotifyEmpty) {
      out.fallback = true
      out.albums = found.albums.map(withLibraryAlbum)
      out.tracks = found.tracks
      out.popularTracks = found.tracks
      out.artists = found.artists.map(withLibraryArtist)
    }
    if (webTracks.length) {
      out.fallback = true
      out.webTracks = webTracks
      // Web matches directly answer the query, so they lead the list; any
      // weak Spotify tracks stay available below them.
      out.tracks = [...webTracks, ...out.tracks]
      out.popularTracks = out.tracks
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* discover detail pages (external entities not in the library yet)    */
/* ------------------------------------------------------------------ */

/* Detail pages for entities that aren't in the library yet. Accepts a
   Spotify id or a catalog key (catalog:artist:<name> /
   catalog:album:<artist>::<album>) so the offline demo has pages too. */

async function catalogArtistDetail(name) {
  const found = await catalogSearch(name)
  const n = norm(name)
  const tracks = found.tracks.filter((t) => norm(t.artist?.name) === n)
  const albums = found.albums.filter((a) => norm(a.artist?.name) === n)
  return {
    artist: withLibraryArtist({ kind: 'artist', id: `catalog-artist:${name}`, name, mbid: null, genres: [] }),
    popularTracks: tracks,
    albums: albums.map(withLibraryAlbum)
  }
}

async function catalogAlbumDetail(artist, album) {
  // Search the artist alone, then filter by album: the mock catalog's
  // haystack joins all of an artist's albums, so a "<artist> <album>"
  // query only matches when they happen to be adjacent.
  const found = await catalogSearch(artist || '')
  const tracks = found.tracks.filter((t) =>
    norm(t.artist?.name) === norm(artist) && (!album || norm(t.album?.title) === norm(album))
  )
  const meta = {
    kind: 'album',
    id: `catalog-album:${artist}:${album}`,
    title: album,
    artist: { name: artist },
    mbid: null,
    year: null,
    image: null,
    trackCount: tracks.length
  }
  return {
    album: { ...withLibraryAlbum(meta), artist: withLibraryArtist({ name: artist, kind: 'artist', id: `catalog-artist:${artist}`, mbid: null }) },
    tracks
  }
}

export async function discoverArtist(key) {
  if (typeof key === 'string' && key.startsWith('catalog:artist:')) {
    const detail = await catalogArtistDetail(key.slice('catalog:artist:'.length))
    detail.artist = await enrichArtist(detail.artist)
    return detail
  }
  const spotifyId = key
  const [detail, popularTracks, albums] = await Promise.all([
    spArtistDetail(spotifyId),
    spTopTracks(spotifyId, 20),
    spArtistAlbumsCached(spotifyId, 12)
  ])
  const name = detail?.name || null
  const genres = detail?.genres || []
  const albumList = dedupeReleases(
    albums
      .filter((a) => a.albumType === 'album' || a.albumType === 'ep')
      .sort((a, b) => albumScore(b) - albumScore(a))
      .slice(0, 12)
  )
  return {
    artist: await enrichArtist(withLibraryArtist({
      kind: 'artist',
      id: `artist:${spotifyId}`,
      name,
      mbid: spotifyId,
      genres,
      image: pickImage(detail.images) || albumList[0]?.image || null
    })),
    popularTracks: popularTracks.slice(0, 10),
    albums: albumList.map(withLibraryAlbum)
  }
}

export async function discoverAlbum(key) {
  if (typeof key === 'string' && key.startsWith('catalog:album:')) {
    const rest = key.slice('catalog:album:'.length)
    const sep = rest.indexOf('::')
    if (sep > 0) return catalogAlbumDetail(rest.slice(0, sep), rest.slice(sep + 2))
  }
  const spotifyId = key
  const [info, tracklist] = await Promise.all([
    spAlbumDetail(spotifyId),
    spAlbumTracksCached(spotifyId)
  ])
  if (!info) throw new Error('Album not found on Spotify')
  const meta = albumEntity(info)
  const album = {
    ...meta,
    artist: meta.artist ? { ...meta.artist, ...withLibraryArtist({ name: meta.artist.name, mbid: null }) } : null,
    ...withLibraryAlbum(meta)
  }
  const tracks = tracklist.map((t, i) => ({
    kind: 'track',
    id: `release-track:${spotifyId}:${t.mbid || i}`,
    title: t.title,
    artist: t.artist ? { name: t.artist } : meta.artist,
    album: { title: meta.title, mbid: spotifyId },
    mbid: t.mbid || null,
    duration: t.length,
    image: meta.image,
    trackNo: t.position
  }))
  return { album, tracks }
}

export async function discoverPlaylist(key) {
  const spotifyId = key
  const [detail, rawTracks] = await Promise.all([
    spPlaylistDetail(spotifyId),
    spPlaylistTracks(spotifyId)
  ])
  if (!detail) throw new Error('Playlist not found on Spotify')
  const playlist = {
    ...playlistEntity(detail),
    id: `playlist:${spotifyId}`
  }
  const tracks = rawTracks.map((t) => {
    const e = trackEntity(t)
    return {
      ...e,
      id: `playlist-track:${spotifyId}:${e.mbid || e.title}`,
      trackNo: t.track_number || null
    }
  })
  return { playlist, tracks }
}

export async function discoverUser(key) {
  const spotifyId = key
  // The /users/{id} profile endpoint is deprecated for client-credentials
  // and there is no user search type in the Web API, so the profile is
  // rebuilt from the user's public playlists (their owners carry the
  // display name). The listing is the useful part of a profile anyway.
  const playlists = await spUserPlaylistsCached(spotifyId)
  const owner = playlists.find((p) => p.ownerId === spotifyId)?.owner
  const user = { kind: 'user', id: spotifyId, mbid: spotifyId, name: owner || spotifyId, image: null, followers: null }
  return { user, playlists }
}

async function mockDiscover(q) {
  const out = { artists: [], albums: [], tracks: [], playlists: [], popularTracks: [], artist: null, fallback: false }
  try {
    const found = await catalogSearch(q)
    // If the query is one of the mock artists, surface their tracks directly.
    let best = null
    let bestScore = 0
    for (const a of found.artists) {
      const s = matchScore(q, a.name)
      if (s > bestScore) { bestScore = s; best = a }
    }
    if (best && bestScore >= 60) {
      const n = norm(best.name)
      const tracks = found.tracks.filter((t) => norm(t.artist?.name) === n)
      const albums = found.albums.filter((a) => norm(a.artist?.name) === n)
      out.artist = withLibraryArtist(best)
      out.popularTracks = tracks
      out.tracks = tracks
      out.albums = albums.map(withLibraryAlbum)
      return out
    }
    out.artists = found.artists.map(withLibraryArtist)
    out.albums = found.albums.map(withLibraryAlbum)
    out.tracks = found.tracks
    out.popularTracks = found.tracks
  } catch { /* nothing to browse */ }
  return out
}

/* ------------------------------------------------------------------ */
/* auto-download (play)                                                */
/* ------------------------------------------------------------------ */

export async function playTrack({ userId, artist, album, title, mbid, image, duration, source }) {
  const existing = findExistingTrack({ mbid, artist, title })
  if (existing) return { tracks: [existing], reused: true }
  // Already downloading (e.g. a background prefetch queued it) — reuse the
  // same row so the caller just waits for it to become available.
  const inFlight = findInFlightTrack({ mbid, artist, title })
  if (inFlight) return { tracks: [inFlight], reused: true }

  let src = source
  if (!src) {
    if (isMockMode()) {
      src = fabricateSource(artist, album, title)
    } else {
      src = await findBestTrackSource({ artist, album, title })
      if (!src) src = await findWebTrackSource({ artist, album, title, duration })
    }
  }
  if (!src) throw new Error(`Could not find “${title}” on Soulseek, YouTube Music or SoundCloud`)

  const trackId = enqueueDownload({
    userId,
    provider: src.provider || 'soulseek',
    username: src.username,
    filename: src.filename,
    size: src.size,
    duration: duration || src.length || 0,
    format: src.format,
    artist,
    album,
    title,
    mbid,
    image,
    ref: src.url,
    alternates: src.alternates || []
  })
  return { tracks: [getTrackRow(trackId)], reused: false }
}

export async function playAlbum({ userId, releaseMbid, artist, album, image, source }) {
  const existing = findExistingAlbum({ artist, album })
  if (existing) return { tracks: existing, reused: true }

  let tracklist = []
  if (releaseMbid && !isMockMode()) {
    try { tracklist = await spAlbumTracksCached(releaseMbid) } catch { tracklist = [] }
  }

  let src = source
  if (!src && !isMockMode()) {
    src = await findAlbumSource({ artist, album, tracklist })
  }

  const downloaded = []
  const remaining = [...tracklist]
  if (isMockMode() && !src) {
    if (tracklist.length) {
      for (const t of tracklist) {
        downloaded.push(enqueueDownload({
          userId,
          ...fabricateSource(artist, album, t.title),
          artist,
          album,
          title: t.title,
          mbid: t.mbid,
          trackNo: t.position,
          image,
          duration: t.length
        }))
      }
    } else {
      const cat = (await catalogAlbums(artist)).find((a) => norm(a.album) === norm(album))
      if (cat) src = { username: cat.username, files: cat.files }
    }
  }

  if (src?.files?.length) {
    for (const file of src.files) {
      if (!tracklist.length) {
        const fm = parseFilename(file.filename)
        downloaded.push(enqueueDownload({
          userId, username: src.username, filename: file.filename, size: file.size,
          duration: file.length, format: file.format, artist, album, title: fm.title, image
        }))
        continue
      }
      if (!remaining.length) break
      let bestIdx = -1
      let bestScore = 0
      const ext = (file.format || '').toLowerCase() || 'flac'
      remaining.forEach((t, i) => {
        const s = ratioVariants(`${t.title}.${ext}`, file.filename, album, 0)
        if (s > bestScore) { bestScore = s; bestIdx = i }
      })
      if (bestIdx < 0 || bestScore <= config.soularr.minimumMatchRatio) continue
      const t = remaining.splice(bestIdx, 1)[0]
      downloaded.push(enqueueDownload({
        userId,
        username: src.username,
        filename: file.filename,
        size: file.size,
        duration: file.length || t?.length || 0,
        format: file.format,
        artist: t?.artist || artist,
        album,
        title: t?.title || parseFilename(file.filename).title,
        mbid: t?.mbid || null,
        trackNo: t?.position || null,
        image
      }))
    }
  }

  // Failover: any Spotify tracklist entry Soulseek didn't cover goes to the
  // web providers (YouTube Music, then SoundCloud) via yt-dlp, so a
  // partially-missing album still plays in full.
  if (remaining.length && webSourceEnabled() && !isMockMode()) {
    for (const t of remaining) {
      const web = await findWebTrackSource({ artist, album, title: t.title, duration: t.length })
      if (!web) continue
      downloaded.push(enqueueDownload({
        userId,
        provider: web.provider,
        username: web.username,
        filename: web.filename,
        size: 0,
        duration: t.length || 0,
        format: 'm4a',
        artist: t.artist || artist,
        album,
        title: t.title,
        mbid: t.mbid,
        trackNo: t.position,
        image,
        ref: web.url
      }))
    }
  }

  if (!downloaded.length) throw new Error(`Could not find “${album}” on Soulseek, YouTube Music or SoundCloud`)
  return { tracks: downloaded.map((id) => getTrackRow(id)), reused: false }
}

export async function playArtist({ userId, name, image }) {
  let artist = null
  if (!isMockMode()) {
    try {
      const artists = await spArtists(name)
      artist = artists[0] || null
    } catch {
      artist = null
    }
  }
  if (artist) {
    let albums = []
    try { albums = await spArtistAlbumsCached(artist.mbid, 1) } catch { albums = [] }
    if (albums[0]) {
      return playAlbum({ userId, releaseMbid: albums[0].mbid, artist: artist.name, album: albums[0].title, image: image || albums[0].image })
    }
  }
  if (isMockMode()) {
    const albums = await catalogAlbums(name)
    if (albums[0]) {
      return playAlbum({ userId, artist: albums[0].artist, album: albums[0].album || 'Unknown', image, source: { username: albums[0].username, files: albums[0].files } })
    }
  }
  throw new Error(`Could not find “${name}”`)
}
