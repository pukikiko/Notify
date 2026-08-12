import crypto from 'node:crypto'
import { db, now } from './db.js'

const SCRYPT = { N: 16384, r: 8, p: 1 }
const KEYLEN = 64

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, KEYLEN, SCRYPT).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':')
  const candidate = crypto.scryptSync(password, salt, KEYLEN, SCRYPT).toString('hex')
  return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hash, 'hex'))
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex')
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, userId, now())
  return token
}

export function getUserById(id) {
  return db.prepare('SELECT id, username, created_at, settings FROM users WHERE id = ?').get(id)
}

export function publicUser(row) {
  if (!row) return null
  return { id: row.id, username: row.username, settings: safeSettings(row.settings) }
}

export function safeSettings(str) {
  try {
    const s = JSON.parse(str || '{}')
    if (!s.preferredFormat) s.preferredFormat = 'mp3-320'
    return s
  } catch {
    return { preferredFormat: 'mp3-320' }
  }
}

export function updateSettings(userId, settings) {
  const user = getUserById(userId)
  const merged = { ...safeSettings(user.settings), ...settings }
  db.prepare('UPDATE users SET settings = ? WHERE id = ?').run(JSON.stringify(merged), userId)
  return publicUser(getUserById(userId))
}

export function authMiddleware(req, res, next) {
  // <audio> tags can't send an Authorization header, so streaming URLs may
  // pass the token as ?t=. API calls keep using the Bearer header.
  let header = req.headers.authorization || ''
  if (!header && req.query?.t) header = `Bearer ${req.query.t}`
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) {
    return res.status(401).json({ error: 'Missing auth token' })
  }
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token)
  if (!session) {
    return res.status(401).json({ error: 'Invalid session' })
  }
  const user = getUserById(session.user_id)
  if (!user) {
    return res.status(401).json({ error: 'Unknown user' })
  }
  req.user = user
  req.userId = user.id
  req.userSettings = safeSettings(user.settings)
  next()
}
