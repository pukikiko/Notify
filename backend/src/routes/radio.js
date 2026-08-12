import { Router } from 'express'
import { authMiddleware } from '../auth.js'
import { db } from '../db.js'
import { buildRadio } from '../radio.js'
import { trackView, artistView, albumView } from './_helpers.js'

const router = Router()
router.use(authMiddleware)

router.get('/seed', (req, res) => {
  const { type = 'track', id, limit = 50 } = req.query
  if (!['track', 'artist', 'album', 'playlist'].includes(type) || !id) {
    return res.status(400).json({ error: 'type (track|artist|album|playlist) and id are required' })
  }
  const ids = buildRadio({ type, id, limit: Number(limit) })
  const tracks = ids
    .map((tid) => db.prepare('SELECT * FROM tracks WHERE id = ?').get(tid))
    .filter(Boolean)
    .map((r) => trackView(r, req.userId))
  res.json({ tracks })
})

router.get('/info/:type/:id', (req, res) => {
  const { type, id } = req.params
  if (type === 'artist') {
    const row = db.prepare('SELECT * FROM artists WHERE id = ?').get(id)
    return res.json(row ? { item: artistView(row, req.userId) } : { error: 'not found' })
  }
  if (type === 'playlist') {
    const row = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id)
    return res.json(row ? { item: { id: row.id, name: row.name } } : { error: 'not found' })
  }
  const row = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id)
  res.json(row ? { item: trackView(row, req.userId) } : { error: 'not found' })
})

export default router
