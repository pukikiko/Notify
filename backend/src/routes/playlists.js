import { Router } from 'express'
import { db, now } from '../db.js'
import { authMiddleware } from '../auth.js'
import { trackView } from './_helpers.js'

const router = Router()
router.use(authMiddleware)

function owned(res, userId, id) {
  const pl = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id)
  if (!pl) {
    res.status(404).json({ error: 'Playlist not found' })
    return null
  }
  if (pl.user_id !== userId) {
    res.status(403).json({ error: 'Not your playlist' })
    return null
  }
  return pl
}

function playlistView(pl) {
  const count = db.prepare('SELECT COUNT(*) c FROM playlist_tracks WHERE playlist_id = ?').get(pl.id).c
  const duration = db.prepare(`
    SELECT COALESCE(SUM(t.duration),0) s FROM playlist_tracks pt
    JOIN tracks t ON t.id = pt.track_id WHERE pt.playlist_id = ?
  `).get(pl.id).s
  const cover = db.prepare(`
    SELECT t.art_path FROM playlist_tracks pt
    JOIN tracks t ON t.id = pt.track_id
    WHERE pt.playlist_id = ? AND t.art_path IS NOT NULL LIMIT 1
  `).get(pl.id)
  return { ...pl, trackCount: count, duration, coverTrackId: cover?.art_path ? cover.art_path : null }
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM playlists WHERE user_id = ? ORDER BY created_at DESC').all(req.userId)
  res.json({ playlists: rows.map(playlistView) })
})

router.post('/', (req, res) => {
  const { name, description = '' } = req.body || {}
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' })
  const info = db.prepare('INSERT INTO playlists (user_id, name, description, created_at) VALUES (?, ?, ?, ?)')
    .run(req.userId, name.trim(), description, now())
  const pl = db.prepare('SELECT * FROM playlists WHERE id = ?').get(Number(info.lastInsertRowid))
  res.status(201).json({ playlist: playlistView(pl) })
})

router.get('/:id', (req, res) => {
  const pl = owned(res, req.userId, Number(req.params.id))
  if (!pl) return
  const rows = db.prepare(`
    SELECT t.* FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
    WHERE pt.playlist_id = ? ORDER BY pt.position
  `).all(pl.id)
  res.json({ playlist: playlistView(pl), tracks: rows.map((r) => trackView(r, req.userId)) })
})

router.patch('/:id', (req, res) => {
  const pl = owned(res, req.userId, Number(req.params.id))
  if (!pl) return
  const { name, description } = req.body || {}
  db.prepare('UPDATE playlists SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?')
    .run(name ?? null, description ?? null, pl.id)
  res.json({ playlist: playlistView(db.prepare('SELECT * FROM playlists WHERE id = ?').get(pl.id)) })
})

router.delete('/:id', (req, res) => {
  const pl = owned(res, req.userId, Number(req.params.id))
  if (!pl) return
  db.prepare('DELETE FROM playlists WHERE id = ?').run(pl.id)
  res.json({ ok: true })
})

router.post('/:id/tracks', (req, res) => {
  const pl = owned(res, req.userId, Number(req.params.id))
  if (!pl) return
  const trackIds = (req.body?.trackIds || []).map(Number).filter(Boolean)
  if (!trackIds.length) return res.status(400).json({ error: 'trackIds required' })
  const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) m FROM playlist_tracks WHERE playlist_id = ?').get(pl.id).m
  const insert = db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)')
  let pos = maxPos + 1
  for (const trackId of trackIds) insert.run(pl.id, trackId, pos++, now())
  res.json({ ok: true, playlist: playlistView(db.prepare('SELECT * FROM playlists WHERE id = ?').get(pl.id)) })
})

router.delete('/:id/tracks/:trackId', (req, res) => {
  const pl = owned(res, req.userId, Number(req.params.id))
  if (!pl) return
  db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').run(pl.id, Number(req.params.trackId))
  res.json({ ok: true })
})

router.post('/:id/reorder', (req, res) => {
  const pl = owned(res, req.userId, Number(req.params.id))
  if (!pl) return
  const trackIds = (req.body?.trackIds || []).map(Number)
  const update = db.prepare('UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?')
  trackIds.forEach((trackId, i) => update.run(i, pl.id, trackId))
  res.json({ ok: true })
})

export default router
