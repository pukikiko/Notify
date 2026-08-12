import { db, safeJson } from '../db.js'
import { findExistingTrack } from '../downloader.js'

export function trackView(row, userId) {
  if (!row) return null
  const artist = row.artist_id ? db.prepare('SELECT id, name, image, genres FROM artists WHERE id = ?').get(row.artist_id) : null
  const album = row.album_id ? db.prepare('SELECT id, title, image, year, mbid FROM albums WHERE id = ?').get(row.album_id) : null
  let liked = false
  if (userId) {
    liked = !!db.prepare('SELECT 1 FROM track_likes WHERE user_id = ? AND track_id = ?').get(userId, row.id)
  }
  return {
    id: row.id,
    title: row.title,
    duration: row.duration,
    bitrate: row.bitrate,
    sourceFormat: row.source_format,
    size: row.size,
    mbid: row.mbid,
    genres: safeJson(row.genres, []),
    status: row.status,
    source: row.source,
    username: row.username,
    createdAt: row.created_at,
    liked,
    artist: artist ? { id: artist.id, name: artist.name, image: artist.image, genres: safeJson(artist.genres, []) } : null,
    album: album ? { id: album.id, title: album.title, image: album.image, year: album.year, mbid: album.mbid } : null,
    // One canonical cover per track: the album art first (so every track in an
    // album matches the album page/cards), then the track's own extracted
    // cover, then the artist image as a last resort.
    artUrl: album?.image || (row.art_path ? `/api/art/${row.id}` : null) || artist?.image || null,
    streamUrl: `/api/stream/${row.id}`
  }
}

export function artistView(row, userId) {
  if (!row) return null
  const liked = userId ? !!db.prepare('SELECT 1 FROM artist_likes WHERE user_id = ? AND artist_id = ?').get(userId, row.id) : false
  return {
    id: row.id,
    name: row.name,
    mbid: row.mbid,
    image: row.image,
    genres: safeJson(row.genres, []),
    similar: safeJson(row.similar, []),
    liked,
    trackCount: db.prepare("SELECT COUNT(*) c FROM tracks WHERE artist_id = ? AND status = 'available'").get(row.id).c,
    albumCount: db.prepare('SELECT COUNT(*) c FROM albums WHERE artist_id = ?').get(row.id).c
  }
}

export function albumView(row, userId) {
  if (!row) return null
  const liked = userId ? !!db.prepare('SELECT 1 FROM album_likes WHERE user_id = ? AND album_id = ?').get(userId, row.id) : false
  return {
    id: row.id,
    title: row.title,
    mbid: row.mbid,
    year: row.year,
    image: row.image,
    genres: safeJson(row.genres, []),
    liked,
    artist: row.artist_id ? (() => { const a = db.prepare('SELECT id, name FROM artists WHERE id = ?').get(row.artist_id); return a ? { id: a.id, name: a.name } : null })() : null,
    trackCount: db.prepare("SELECT COUNT(*) c FROM tracks WHERE album_id = ? AND status = 'available'").get(row.id).c
  }
}

/* Full Spotify/catalog listings contain tracks that may not be downloaded
   yet. Merge each one with its library row (if any) so the UI can render a
   single Spotify-like list: downloaded rows play instantly, the rest resolve
   on demand via /discover/play. */
export function mergeDiscoverTrack(t, userId) {
  if (!t) return null
  if (t.streamUrl || typeof t.id === 'number') return { ...t, downloaded: true }
  const existing = findExistingTrack({ mbid: t.mbid, artist: t.artist?.name, title: t.title })
  if (existing) {
    return { ...t, ...trackView(existing, userId), downloaded: true }
  }
  return { ...t, downloaded: false }
}
