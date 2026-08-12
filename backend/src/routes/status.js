import { Router } from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { authMiddleware } from '../auth.js'
import { db } from '../db.js'
import { soulseek } from '../soulseek.js'
import { youtubeEnabled, soundcloudEnabled } from '../web.js'
import { config, ORIGINAL_DIR, TRANSCODED_DIR, FORMATS } from '../config.js'

const router = Router()

router.get('/', authMiddleware, async (req, res) => {
  let ss = { connected: false, mode: config.soulseekMode, username: null }
  try {
    ss = await soulseek.status()
  } catch { /* unreachable via this call */ }
  const available = db.prepare("SELECT COUNT(*) c FROM tracks WHERE status = 'available'").get().c
  const downloading = db.prepare("SELECT COUNT(*) c FROM tracks WHERE status = 'downloading'").get().c
  const formats = {}
  for (const [key, info] of Object.entries(FORMATS)) formats[key] = info.label
  res.json({
    soulseek: ss,
    sources: {
      soulseek: { enabled: true, mode: config.soulseekMode },
      youtube: { enabled: youtubeEnabled(), binary: config.youtube.binary },
      soundcloud: { enabled: soundcloudEnabled(), binary: config.youtube.binary }
    },
    cache: {
      availableTracks: available,
      downloading,
      originalBytes: dirSize(ORIGINAL_DIR),
      transcodedBytes: dirSize(TRANSCODED_DIR)
    },
    formats
  })
})

function dirSize(dir) {
  let total = 0
  try {
    for (const f of fs.readdirSync(dir)) {
      try {
        total += fs.statSync(path.join(dir, f)).size
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return total
}

router.get('/user', authMiddleware, (req, res) => {
  const likedTracks = db.prepare('SELECT COUNT(*) c FROM track_likes WHERE user_id = ?').get(req.userId).c
  const likedArtists = db.prepare('SELECT COUNT(*) c FROM artist_likes WHERE user_id = ?').get(req.userId).c
  const likedAlbums = db.prepare('SELECT COUNT(*) c FROM album_likes WHERE user_id = ?').get(req.userId).c
  const playlists = db.prepare('SELECT COUNT(*) c FROM playlists WHERE user_id = ?').get(req.userId).c
  res.json({ likedTracks, likedArtists, likedAlbums, playlists })
})

export default router
