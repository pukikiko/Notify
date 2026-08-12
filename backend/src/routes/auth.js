import { Router } from 'express'
import { db, now } from '../db.js'
import { hashPassword, verifyPassword, createSession, publicUser, authMiddleware, updateSettings } from '../auth.js'

const router = Router()

router.post('/register', (req, res) => {
  const { username, password } = req.body || {}
  if (!username || typeof username !== 'string' || username.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' })
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' })
  }
  const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)
  if (exists) return res.status(409).json({ error: 'Username already taken' })

  const info = db.prepare('INSERT INTO users (username, password_hash, created_at, settings) VALUES (?, ?, ?, ?)')
    .run(username, hashPassword(password), now(), JSON.stringify({ preferredFormat: 'mp3-320' }))
  const userId = Number(info.lastInsertRowid)
  const token = createSession(userId)
  res.status(201).json({ token, user: publicUser(db.prepare('SELECT id, username, created_at, settings FROM users WHERE id = ?').get(userId)) })
})

router.post('/login', (req, res) => {
  const { username, password } = req.body || {}
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username || '')
  if (!user || !verifyPassword(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' })
  }
  const token = createSession(user.id)
  res.json({ token, user: publicUser(user) })
})

router.post('/logout', authMiddleware, (req, res) => {
  const header = req.headers.authorization || ''
  db.prepare('DELETE FROM sessions WHERE token = ?').run(header.slice(7))
  res.json({ ok: true })
})

router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: publicUser(req.user) })
})

router.get('/settings', authMiddleware, (req, res) => {
  res.json({ settings: req.userSettings })
})

router.put('/settings', authMiddleware, (req, res) => {
  const { preferredFormat, displayName } = req.body || {}
  const next = {}
  if (preferredFormat !== undefined) next.preferredFormat = preferredFormat
  if (displayName !== undefined) next.displayName = displayName
  const user = updateSettings(req.userId, next)
  res.json({ settings: user.settings })
})

export default router
