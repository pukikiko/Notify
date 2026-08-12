import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config, DATA_DIR } from './config.js'
import { startDownloader } from './downloader.js'
import authRoutes from './routes/auth.js'
import searchRoutes from './routes/search.js'
import libraryRoutes from './routes/library.js'
import playlistRoutes from './routes/playlists.js'
import radioRoutes from './routes/radio.js'
import streamRoutes from './routes/stream.js'
import statusRoutes from './routes/status.js'

fs.mkdirSync(DATA_DIR, { recursive: true })

const app = express()
app.use(express.json({ limit: '2mb' }))

app.use('/api/auth', authRoutes)
// Mounted before the auth-requiring routers below: cover art is served by a
// public endpoint (track art is not user-private) and <img> tags can't send
// an Authorization header. Mounting this router first keeps /api/art from
// being intercepted by the router-level authMiddleware on the other /api
// routers. /api/stream still applies its own per-route auth.
app.use('/api', streamRoutes)
app.use('/api', searchRoutes)
app.use('/api/library', libraryRoutes)
app.use('/api/playlists', playlistRoutes)
app.use('/api/radio', radioRoutes)
app.use('/api/status', statusRoutes)

// serve built frontend when present
const frontendDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist')
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist))
  app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/art/') || req.path.startsWith('/stream/')) return next()
    res.sendFile(path.join(frontendDist, 'index.html'))
  })
}

app.use((req, res) => res.status(404).json({ error: 'Not found' }))

startDownloader()

app.listen(config.port, () => {
  console.log(`Notify backend listening on http://localhost:${config.port}`)
  console.log(`Soulseek mode: ${config.soulseekMode} (set SOULSEEK_MODE=slskd for the real network)`)
})
