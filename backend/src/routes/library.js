import { Router } from 'express'
import { db, now } from '../db.js'
import { authMiddleware } from '../auth.js'
import { trackView, artistView, albumView, mergeDiscoverTrack } from './_helpers.js'
import { discoverArtist, discoverAlbum, catalogArtistKey, catalogAlbumKey, libraryAlbumId, enrichArtist } from '../resolver.js'
import { spotifyConfigured, spSearchArtists, spSearchAlbums } from '../spotify.js'
import { isMockMode } from '../soulseek.js'

function norm(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/* The library row usually carries the Spotify id (from enrichment), but if
   it doesn't we can still resolve it by searching Spotify by name. */
async function artistSpotifyId(artist) {
  if (artist.mbid) return artist.mbid
  if (!spotifyConfigured()) return null
  try {
    const hits = await spSearchArtists(artist.name)
    const exact = hits.find((a) => norm(a.name) === norm(artist.name))
    return (exact || hits[0])?.mbid || null
  } catch {
    return null
  }
}

async function albumSpotifyId(album, artistName) {
  if (album.mbid) return album.mbid
  if (!spotifyConfigured()) return null
  try {
    const hits = await spSearchAlbums(`${album.title} ${artistName || ''}`.trim())
    const exact = hits.find((a) =>
      norm(a.title) === norm(album.title) &&
      (!artistName || norm(a.artist?.name) === norm(artistName))
    )
    return (exact || hits[0])?.mbid || null
  } catch {
    return null
  }
}

const router = Router()
router.use(authMiddleware)

function toggleLike(table, userId, id) {
  const exists = db.prepare(`SELECT 1 FROM ${table} WHERE user_id = ? AND ${table.replace(/_likes$/, '')}_id = ?`).get(userId, id)
  if (exists) {
    db.prepare(`DELETE FROM ${table} WHERE user_id = ? AND ${table.replace(/_likes$/, '')}_id = ?`).run(userId, id)
    return { liked: false }
  }
  db.prepare(`INSERT INTO ${table} (user_id, ${table.replace(/_likes$/, '')}_id, created_at) VALUES (?, ?, ?)`).run(userId, id, now())
  return { liked: true }
}

/* ---- tracks ---- */
router.get('/tracks', (req, res) => {
  const rows = db.prepare("SELECT * FROM tracks WHERE status = 'available' ORDER BY id DESC LIMIT 200").all()
  res.json({ tracks: rows.map((r) => trackView(r, req.userId)) })
})

router.get('/tracks/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM tracks WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Track not found' })
  res.json({ track: trackView(row, req.userId) })
})

router.post('/tracks/:id/like', (req, res) => {
  res.json(toggleLike('track_likes', req.userId, Number(req.params.id)))
})

/* ---- albums ---- */
router.get('/albums', (req, res) => {
  const rows = db.prepare('SELECT * FROM albums ORDER BY title').all()
  res.json({ albums: rows.map((r) => albumView(r, req.userId)) })
})

router.get('/albums/:id', async (req, res) => {
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(req.params.id)
  if (!album) return res.status(404).json({ error: 'Album not found' })
  const artistRow = album.artist_id ? db.prepare('SELECT * FROM artists WHERE id = ?').get(album.artist_id) : null

  let tracks = []
  let spMeta = null

  // Prefer the full Spotify/catalog tracklist so the album page shows every
  // song like Spotify, not just the ones that happen to be downloaded.
  try {
    if (isMockMode()) {
      const detail = await discoverAlbum(catalogAlbumKey(artistRow?.name || 'Unknown', album.title))
      tracks = detail.tracks || []
      spMeta = detail.album || null
    } else if (spotifyConfigured()) {
      const spId = await albumSpotifyId(album, artistRow?.name)
      if (spId) {
        const detail = await discoverAlbum(spId)
        tracks = detail.tracks || []
        spMeta = detail.album || null
      }
    }
  } catch (err) {
    console.error('[library] album merge failed, falling back', err.message)
    tracks = []
  }

  if (!tracks.length) {
    const rows = db.prepare("SELECT * FROM tracks WHERE album_id = ? AND status = 'available' ORDER BY disc_no, track_no").all(album.id)
    tracks = rows.map((r) => trackView(r, req.userId))
  }

  const view = albumView(album, req.userId)
  if (spMeta) {
    // Prefer the real Spotify cover over nothing or a generated placeholder,
    // and persist it so every track in the album (and the album card) show
    // the exact same artwork.
    if ((!view.image || view.image.startsWith('/api/art/album/')) && spMeta.image) {
      db.prepare('UPDATE albums SET image = ? WHERE id = ?').run(spMeta.image, album.id)
      view.image = spMeta.image
    }
    view.year = view.year || spMeta.year || null
    view.mbid = view.mbid || spMeta.mbid || null
    view.trackCount = spMeta.trackCount || view.trackCount
  }
  view.href = `/album/${album.id}`

  res.json({
    album: view,
    tracks: tracks.map((t) => mergeDiscoverTrack(t, req.userId))
  })
})

router.post('/albums/:id/like', (req, res) => {
  res.json(toggleLike('album_likes', req.userId, Number(req.params.id)))
})

/* ---- artists ---- */
router.get('/artists', (req, res) => {
  const rows = db.prepare('SELECT * FROM artists ORDER BY name').all()
  res.json({ artists: rows.map((r) => artistView(r, req.userId)) })
})

router.get('/artists/:id', async (req, res) => {
  const artist = db.prepare('SELECT * FROM artists WHERE id = ?').get(req.params.id)
  if (!artist) return res.status(404).json({ error: 'Artist not found' })

  let popularTracks = []
  let albums = []

  // Full Spotify/catalog listing (popular tracks + discography) so the page
  // matches Spotify instead of only the downloaded subset.
  try {
    if (isMockMode()) {
      const detail = await discoverArtist(catalogArtistKey(artist.name))
      popularTracks = detail.popularTracks || []
      albums = detail.albums || []
    } else if (spotifyConfigured()) {
      const spId = await artistSpotifyId(artist)
      if (spId) {
        const detail = await discoverArtist(spId)
        popularTracks = detail.popularTracks || []
        albums = detail.albums || []
      }
    }
  } catch (err) {
    console.error('[library] artist merge failed, falling back', err.message)
    popularTracks = []
    albums = []
  }

  if (!popularTracks.length) {
    const rows = db.prepare(`
      SELECT t.* FROM tracks t
      WHERE t.artist_id = ? AND t.status = 'available'
      ORDER BY (SELECT COUNT(*) FROM track_likes WHERE track_id = t.id) DESC, t.id DESC LIMIT 100
    `).all(artist.id)
    popularTracks = rows.map((r) => trackView(r, req.userId))
  }
  if (!albums.length) {
    albums = db.prepare('SELECT * FROM albums WHERE artist_id = ?').all(artist.id)
      .map((r) => ({ ...albumView(r, req.userId), href: `/album/${r.id}` }))
  } else {
    albums = albums.map((a) => {
      const libId = libraryAlbumId({ title: a.title, artistName: a.artist?.name, mbid: a.mbid })
      return { ...a, libraryId: libId }
    })
  }

  const view = await enrichArtist(artistView(artist, req.userId))
  // Surface full-discography numbers instead of "N downloaded songs".
  if (albums.length) {
    const full = albums.reduce((n, a) => n + (a.trackCount || 0), 0)
    if (full > view.trackCount) view.trackCount = full
    if (albums.length > view.albumCount) view.albumCount = albums.length
  }

  res.json({
    artist: view,
    tracks: popularTracks.map((t) => mergeDiscoverTrack(t, req.userId)),
    popularTracks: popularTracks.map((t) => mergeDiscoverTrack(t, req.userId)),
    albums
  })
})

router.post('/artists/:id/like', (req, res) => {
  res.json(toggleLike('artist_likes', req.userId, Number(req.params.id)))
})

/* ---- liked collection ---- */
router.get('/liked/tracks', (req, res) => {
  const rows = db.prepare(`
    SELECT t.* FROM track_likes l JOIN tracks t ON t.id = l.track_id
    WHERE l.user_id = ? AND t.status = 'available' ORDER BY l.created_at DESC
  `).all(req.userId)
  res.json({ tracks: rows.map((r) => trackView(r, req.userId)) })
})

router.get('/liked/albums', (req, res) => {
  const rows = db.prepare('SELECT a.* FROM album_likes l JOIN albums a ON a.id = l.album_id WHERE l.user_id = ? ORDER BY l.created_at DESC').all(req.userId)
  res.json({ albums: rows.map((r) => albumView(r, req.userId)) })
})

router.get('/liked/artists', (req, res) => {
  const rows = db.prepare('SELECT a.* FROM artist_likes l JOIN artists a ON a.id = l.artist_id WHERE l.user_id = ? ORDER BY l.created_at DESC').all(req.userId)
  res.json({ artists: rows.map((r) => artistView(r, req.userId)) })
})

/* ---- home: what's popular on this instance ---- */
router.get('/home', async (req, res) => {
  // "Popular" is measured by how much this instance's users engaged with a
  // track: likes count most, then downloads, then recency as a tiebreak.
  const popularTracks = db.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM track_likes l WHERE l.track_id = t.id) AS like_count,
      (SELECT COUNT(*) FROM downloads d WHERE d.track_id = t.id) AS dl_count
    FROM tracks t
    WHERE t.status = 'available'
    ORDER BY like_count DESC, dl_count DESC, t.id DESC
    LIMIT 20
  `).all().map((r) => trackView(r, req.userId))

  const popularAlbums = db.prepare(`
    SELECT al.*,
      (SELECT COUNT(*) FROM track_likes l JOIN tracks t ON t.id = l.track_id WHERE t.album_id = al.id) AS like_count,
      (SELECT COUNT(*) FROM downloads d JOIN tracks t ON t.id = d.track_id WHERE t.album_id = al.id) AS dl_count
    FROM albums al
    ORDER BY like_count DESC, dl_count DESC, al.id DESC
    LIMIT 20
  `).all().map((r) => albumView(r, req.userId))

  const popularArtistRows = db.prepare(`
    SELECT ar.*,
      (SELECT COUNT(*) FROM track_likes l JOIN tracks t ON t.id = l.track_id WHERE t.artist_id = ar.id) AS like_count,
      (SELECT COUNT(*) FROM downloads d JOIN tracks t ON t.id = d.track_id WHERE t.artist_id = ar.id) AS dl_count
    FROM artists ar
    ORDER BY like_count DESC, dl_count DESC, ar.id DESC
    LIMIT 20
  `).all().map((r) => artistView(r, req.userId))

  const recentAlbums = db.prepare('SELECT * FROM albums ORDER BY id DESC LIMIT 20').all()
    .map((r) => ({ ...albumView(r, req.userId), href: `/album/${r.id}` }))

  const recentTracks = db.prepare("SELECT * FROM tracks WHERE status = 'available' ORDER BY id DESC LIMIT 20").all()
    .map((r) => trackView(r, req.userId))

  const liked = db.prepare(`
    SELECT t.* FROM track_likes l JOIN tracks t ON t.id = l.track_id
    WHERE l.user_id = ? AND t.status = 'available' ORDER BY l.created_at DESC LIMIT 20
  `).all(req.userId).map((r) => trackView(r, req.userId))

  // The showcase renders the top few with a Wikipedia bio + artwork; enrich
  // the head of the list (cached server-side, so later loads are instant).
  const [showcase, rest] = [popularArtistRows.slice(0, 8), popularArtistRows.slice(8)]
  const enriched = await Promise.all(showcase.map((a) => enrichArtist(a)))

  res.json({
    popularTracks,
    popularAlbums,
    popularArtists: [...enriched, ...rest],
    recentAlbums,
    recentTracks,
    liked
  })
})

/* ---- downloads (in-flight) ---- */
router.get('/downloads', (req, res) => {
  const rows = db.prepare(`
    SELECT t.*, d.status AS dl_status, d.username AS dl_username, d.filename AS dl_filename
    FROM downloads d JOIN tracks t ON t.id = d.track_id
    WHERE d.user_id = ? AND d.status IN ('queued','downloading')
    ORDER BY d.added_at DESC
  `).all(req.userId)
  res.json({ downloads: rows.map((r) => trackView(r, req.userId)) })
})

export default router
