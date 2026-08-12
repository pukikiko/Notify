import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { authMiddleware } from '../auth.js'
import { db } from '../db.js'
import { transcode, getTranscodedPath } from '../transcoder.js'
import { formatInfo, ART_DIR } from '../config.js'
import { extractEmbeddedCover, saveTrackCover } from '../metadata.js'

const router = Router()

function serveRange(req, res, filePath, mime) {
  const stat = fs.statSync(filePath)
  const total = stat.size
  const range = req.headers.range
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    let start = m && m[1] ? parseInt(m[1], 10) : 0
    let end = m && m[2] ? parseInt(m[2], 10) : total - 1
    if (isNaN(start) || start < 0) start = 0
    if (isNaN(end) || end >= total) end = total - 1
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` })
      return res.end()
    }
    res.writeHead(206, {
      'Content-Type': mime,
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Cache-Control': 'private, max-age=31536000'
    })
    fs.createReadStream(filePath, { start, end }).pipe(res)
  } else {
    res.writeHead(200, {
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
      'Content-Length': total,
      'Cache-Control': 'private, max-age=31536000'
    })
    fs.createReadStream(filePath).pipe(res)
  }
}

router.get('/art/album/:albumId', (req, res) => {
  const p = path.join(ART_DIR, `album-${req.params.albumId}.png`)
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'No artwork' })
  res.setHeader('Content-Type', 'image/png')
  res.setHeader('Cache-Control', 'public, max-age=86400')
  return fs.createReadStream(p).pipe(res)
})

router.get('/art/:trackId', async (req, res) => {
  const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(req.params.trackId)
  if (!track) return res.status(404).json({ error: 'No artwork' })
  let p = track.art_path || null
  // No stored cover yet — pull the embedded art straight out of the cached
  // file and remember it, so the next request is a plain file read.
  if ((!p || !fs.existsSync(p)) && track.source_path && fs.existsSync(track.source_path)) {
    const cover = await extractEmbeddedCover(track.source_path)
    if (cover) {
      try {
        p = await saveTrackCover(track.id, cover.data, cover.contentType)
        db.prepare('UPDATE tracks SET art_path = ? WHERE id = ? AND art_path IS NULL').run(p, track.id)
      } catch {
        p = null
      }
    }
  }
  if (p && fs.existsSync(p)) {
    const ext = path.extname(p).replace('.', '')
    res.setHeader('Content-Type', ext === 'png' ? 'image/png' : 'image/jpeg')
    res.setHeader('Cache-Control', 'public, max-age=86400')
    return fs.createReadStream(p).pipe(res)
  }
  res.status(404).json({ error: 'No artwork' })
})

router.get('/stream/:trackId', authMiddleware, async (req, res) => {
  const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(req.params.trackId)
  if (!track || track.status !== 'available') {
    return res.status(404).json({ error: 'Track not available yet' })
  }
  if (!track.source_path || !fs.existsSync(track.source_path)) {
    return res.status(410).json({ error: 'Source file missing from cache' })
  }

  const format = req.userSettings.preferredFormat || 'mp3-320'
  try {
    const { path: outPath, transcoded } = getTranscodedPath(track.source_path, format)
    if (transcoded && !fs.existsSync(outPath)) {
      await transcode(track.source_path, format)
    }
    const mime = transcoded ? formatInfo(format).mime : mimeForFile(track.source_path)
    serveRange(req, res, outPath, mime)
  } catch (err) {
    console.error('[stream] failed', err.message)
    res.status(500).json({ error: 'Streaming failed' })
  }
})

function mimeForFile(p) {
  switch (path.extname(p).replace('.', '').toLowerCase()) {
    case 'mp3': return 'audio/mpeg'
    case 'flac': return 'audio/flac'
    case 'ogg': return 'audio/ogg'
    case 'opus': return 'audio/ogg'
    case 'm4a': case 'aac': return 'audio/mp4'
    case 'webm': return 'audio/webm'
    case 'wav': return 'audio/wav'
    default: return 'application/octet-stream'
  }
}

export default router
