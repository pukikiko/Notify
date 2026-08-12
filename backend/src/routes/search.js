import { Router } from 'express'
import { db } from '../db.js'
import { authMiddleware } from '../auth.js'
import { soulseek, isMockMode } from '../soulseek.js'
import { enqueueDownload } from '../downloader.js'
import { discoverSearch, playTrack, playAlbum, playArtist, discoverArtist, discoverAlbum, discoverPlaylist, discoverUser } from '../resolver.js'
import { trackView, artistView, albumView, mergeDiscoverTrack } from './_helpers.js'

const router = Router()
router.use(authMiddleware)

/* Rank results: exact match first, then prefix, then fuzzy; ties go to
   the most-liked tracks and most recent additions. */
router.get('/library/search', (req, res) => {
  const raw = (req.query.q || '').trim()
  const q = `%${raw}%`
  const prefix = `${raw}%`

  const tracks = db.prepare(`
    SELECT t.*,
      CASE
        WHEN lower(t.title) = lower(?) THEN 0
        WHEN lower(t.title) LIKE lower(?) THEN 1
        WHEN lower(ar.name) = lower(?) OR lower(al.title) = lower(?) THEN 2
        ELSE 3
      END AS rank,
      (SELECT COUNT(*) FROM track_likes WHERE track_id = t.id) AS like_count
    FROM tracks t
    LEFT JOIN artists ar ON ar.id = t.artist_id
    LEFT JOIN albums al ON al.id = t.album_id
    WHERE t.status = 'available'
      AND (t.title LIKE ? OR ar.name LIKE ? OR al.title LIKE ?)
    ORDER BY rank ASC, like_count DESC, t.id DESC LIMIT 50
  `).all(raw, prefix, raw, raw, q, q, q).map((r) => trackView(r, req.userId))

  const artists = db.prepare(`
    SELECT *,
      CASE
        WHEN name = ? COLLATE NOCASE THEN 0
        WHEN name LIKE ? COLLATE NOCASE THEN 1
        ELSE 2
      END AS rank
    FROM artists
    WHERE name LIKE ?
    ORDER BY rank ASC, name LIMIT 30
  `).all(raw, prefix, q).map((r) => artistView(r, req.userId))

  const albums = db.prepare(`
    SELECT al.*,
      CASE
        WHEN al.title = ? COLLATE NOCASE THEN 0
        WHEN al.title LIKE ? COLLATE NOCASE THEN 1
        WHEN ar.name = ? COLLATE NOCASE THEN 2
        ELSE 3
      END AS rank
    FROM albums al
    LEFT JOIN artists ar ON ar.id = al.artist_id
    WHERE al.title LIKE ? OR ar.name LIKE ?
    ORDER BY rank ASC, al.title LIMIT 30
  `).all(raw, prefix, raw, q, q).map((r) => albumView(r, req.userId))

  res.json({ tracks, artists, albums })
})

/* ------------------------------------------------------------------ */
/* Discover: external metadata (Spotify) resolves the query into       */
/* clean artists/albums/tracks, and the app figures out the download.  */
/* ------------------------------------------------------------------ */

router.get('/discover/search', async (req, res) => {
  const q = (req.query.q || '').trim()
  if (!q) {
    if (isMockMode()) {
      try { return res.json(await discoverSearch('')) } catch (err) { return res.json({ artists: [], albums: [], tracks: [], fallback: true }) }
    }
    return res.json({ artists: [], albums: [], tracks: [], fallback: false })
  }
  // Never hard-fail the whole search: degrade gracefully to whatever is
  // available (library/catalog) instead of leaving the UI stuck.
  try {
    const out = await discoverSearch(q)
    res.json(out)
  } catch (err) {
    console.error('[discover] search failed', err.message)
    res.json({ artists: [], albums: [], tracks: [], fallback: true, error: err.message })
  }
})

router.get('/discover/artist/:mbid', async (req, res) => {
  try {
    const out = await discoverArtist(req.params.mbid)
    if (!out.artist?.name) return res.status(404).json({ error: 'Artist not found' })
    // Mark tracks that are already downloaded so they render as playable rows.
    out.popularTracks = (out.popularTracks || []).map((t) => mergeDiscoverTrack(t, req.userId))
    out.tracks = (out.tracks || []).map((t) => mergeDiscoverTrack(t, req.userId))
    res.json(out)
  } catch (err) {
    console.error('[discover] artist failed', err.message)
    res.status(404).json({ error: err.message })
  }
})

router.get('/discover/album/:mbid', async (req, res) => {
  try {
    const out = await discoverAlbum(req.params.mbid)
    if (!out.album?.title) return res.status(404).json({ error: 'Album not found' })
    out.tracks = (out.tracks || []).map((t) => mergeDiscoverTrack(t, req.userId))
    res.json(out)
  } catch (err) {
    console.error('[discover] album failed', err.message)
    res.status(404).json({ error: err.message })
  }
})

router.get('/discover/playlist/:id', async (req, res) => {
  try {
    const out = await discoverPlaylist(req.params.id)
    if (!out.playlist?.name) return res.status(404).json({ error: 'Playlist not found' })
    out.tracks = (out.tracks || []).map((t) => mergeDiscoverTrack(t, req.userId))
    res.json(out)
  } catch (err) {
    console.error('[discover] playlist failed', err.message)
    res.status(404).json({ error: err.message })
  }
})

router.get('/discover/user/:id', async (req, res) => {
  try {
    const out = await discoverUser(req.params.id)
    if (!out.user?.id) return res.status(404).json({ error: 'User not found' })
    res.json(out)
  } catch (err) {
    console.error('[discover] user failed', err.message)
    res.status(404).json({ error: err.message })
  }
})

router.post('/discover/play', async (req, res) => {
  const { kind, source, artist, album, title, mbid, releaseMbid, image, duration } = req.body || {}
  if ((kind !== 'album' && kind !== 'artist') && !(title && title.trim())) {
    return res.status(400).json({ error: 'title is required' })
  }
  try {
    let result
    if (kind === 'album') {
      result = await playAlbum({ userId: req.userId, releaseMbid, artist, album, image, source })
    } else if (kind === 'artist') {
      result = await playArtist({ userId: req.userId, name: artist || title, image })
    } else {
      result = await playTrack({ userId: req.userId, artist, album, title, mbid, image, duration, source })
    }
    res.status(result.reused ? 200 : 202).json({
      tracks: result.tracks.map((t) => trackView(t, req.userId)),
      download: !result.reused
    })
  } catch (err) {
    console.error('[discover] play failed', err.message)
    res.status(404).json({ error: err.message })
  }
})

/* Resolve a batch of discover tracks into playable library rows at once
   (used by the "play all" actions on artist/album pages). Reuses anything
   already cached and skips items that can't be found. */
router.post('/discover/play-many', async (req, res) => {
  const items = (Array.isArray(req.body?.items) ? req.body.items : []).filter((it) => it && typeof it.title === 'string' && it.title.trim())
  if (!items.length) return res.status(400).json({ error: 'items are required' })
  try {
    const tracks = []
    const seen = new Set()
    for (const it of items) {
      try {
        const result = await playTrack({
          userId: req.userId,
          artist: it.artist,
          album: it.album,
          title: it.title,
          mbid: it.mbid,
          image: it.image,
          duration: it.duration,
          source: it.source
        })
        for (const t of result.tracks) {
          if (seen.has(t.id)) continue
          seen.add(t.id)
          tracks.push(trackView(t, req.userId))
        }
      } catch (err) {
        console.error('[discover] play-many track failed', it.title, err.message)
      }
    }
    if (!tracks.length) return res.status(404).json({ error: 'Nothing playable found' })
    res.status(202).json({ tracks, download: true })
  } catch (err) {
    console.error('[discover] play-many failed', err.message)
    res.status(404).json({ error: err.message })
  }
})

/* ------------------------------------------------------------------ */
/* raw Soulseek access (kept for advanced users)                       */
/* ------------------------------------------------------------------ */

router.get('/soulseek/search', async (req, res) => {
  const q = (req.query.q || '').trim()
  if (!q && !isMockMode()) return res.json({ results: [] })
  try {
    const results = await soulseek.search(q, Number(req.query.limit || 60))
    res.json({ results })
  } catch (err) {
    console.error('[soulseek] search failed', err.message)
    res.status(502).json({ error: `Soulseek search failed: ${err.message}` })
  }
})

router.post('/soulseek/download', async (req, res) => {
  const { username, filename, size, duration, format } = req.body || {}
  if (!username || !filename) return res.status(400).json({ error: 'username and filename are required' })
  try {
    const trackId = await enqueueDownload({ userId: req.userId, username, filename, size, duration, format })
    const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId)
    res.status(202).json({ track: trackView(track, req.userId), download: true })
  } catch (err) {
    console.error('[soulseek] download enqueue failed', err.message)
    res.status(502).json({ error: err.message })
  }
})

export default router
