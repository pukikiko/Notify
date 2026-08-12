import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { config, ORIGINAL_DIR } from './config.js'

const pExec = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, ...opts }, (err, stdout, stderr) =>
      err ? reject(new Error(`${cmd} ${args.join(' ')}\n${stderr}`)) : resolve(stdout)
    )
  })

/* ------------------------------------------------------------------ */
/* Mock backend: fully offline. "Downloads" synthesize audio via ffmpeg */
/* ------------------------------------------------------------------ */

const CATALOG = [
  { artist: 'Neon Dusk', albums: ['Electric Bloom', 'Midnight Static'], genre: 'synthwave' },
  { artist: 'The Paper Lanterns', albums: ['Glasshouse', 'Paper Moon'], genre: 'indie folk' },
  { artist: 'Kilohertz', albums: ['Overclock', 'Signal Loss'], genre: 'electronic' },
  { artist: 'Marisol Vega', albums: ['Corazón de Piedra', 'La Luz'], genre: 'latin pop' },
  { artist: 'Blackwater Motel', albums: ['Dust & Neon', 'Rattlesnake Line'], genre: 'blues rock' },
  { artist: 'Astral Projection Unit', albums: ['Deep Field', 'Exoplanet'], genre: 'ambient' },
  { artist: 'Velvet Circuit', albums: ['Analog Heart', 'Glass Frequency'], genre: 'alternative' },
  { artist: 'The Hollow Coves', albums: ['Fallow Fields', 'Winter Thaw'], genre: 'chamber pop' },
  { artist: 'Ratpack Wonderland', albums: ['Splatter', 'Gutter Ballet'], genre: 'punk' },
  { artist: 'Sienna & The Embers', albums: ['Wildfire', 'Slow Burn'], genre: 'americana' },
  { artist: 'Mono Chrome', albums: ['Monolith', 'Afterimage'], genre: 'post-punk' },
  { artist: 'DJ Sable', albums: ['Night Shift', 'Hourglass'], genre: 'house' },
  { artist: 'Grey Fox Landing', albums: ['Northern Skies', 'Weathering'], genre: 'indie rock' },
  { artist: 'The Amathysts', albums: ['Crystalline', 'Petrichor'], genre: 'dream pop' },
  { artist: 'Wired & Tired', albums: ['Static Hiss', 'Feedback Loop'], genre: 'noise rock' },
  { artist: 'Orchid Division', albums: ['Terra Incognita', 'Botany'], genre: 'post-rock' },
  { artist: 'Luna Norte', albums: ['Noche Cerrada', 'Aurora'], genre: 'synth pop' },
  { artist: 'The Gaslight Giants', albums: ['Kindling', 'Fire Escape'], genre: 'folk rock' },
  { artist: 'Polar Opposites', albums: ['Meridian', 'Degrees of Freedom'], genre: 'shoegaze' },
  { artist: 'Combo Rumba', albums: ['Noche de Fiesta', 'Salsa Brava'], genre: 'latin' },
  { artist: 'Static Bloom', albums: ['Neon Meadow', 'Frequency Garden'], genre: 'trip hop' },
  { artist: 'The Cedar Rooms', albums: ['Hollow Halls', 'Antler Season'], genre: 'indie folk' },
  { artist: 'Violet Apex', albums: ['Chromatics', 'Prism'], genre: 'electropop' },
  { artist: 'Brick & Mortar', albums: ['Foundations', 'Load Bearing'], genre: 'indie rock' },
  { artist: 'Saltwater Gospel', albums: ['Tidewater', 'Sanctuary'], genre: 'acoustic' },
  { artist: 'Nine Out of Ten', albums: ['Mostly Harmless', 'Rounded Up'], genre: 'pop punk' },
  { artist: 'The Ember Garden', albums: ['Kindle', 'Ashfall'], genre: 'acoustic' },
  { artist: 'Magnetar', albums: ['Ultraluminous', 'Event Horizon'], genre: 'progressive' },
  { artist: 'Sunday Service', albums: ['Amen Chorus', 'Grace Notes'], genre: 'soul' },
  { artist: 'Foxtrot Uniform', albums: ['Callsign', 'Frequency Hopper'], genre: 'electronic' }
]

const TRACK_NAMES = [
  'Into the Blue', 'Gravity Well', 'Paper Planes', 'Night Drive', 'Fading Signal',
  'Golden Hour', 'Loose Ends', 'Tidal Wave', 'Cold Front', 'Static Love',
  'Second Chance', 'Midnight Run', 'Afterglow', 'Wildcard', 'Slow Motion',
  'Echo Chamber', 'Parallel Lines', 'Still Waters', 'Breakaway', 'High Voltage',
  'Low Light', 'Vanishing Point', 'Crossfire', 'Daylight Saving', 'Backlit',
  'Hollow Crown', 'White Noise', 'Silent Movie', 'Radar Love', 'Open Road',
  'Last Resort', 'Blue Hour', 'Chain Reaction', 'Magnetic North', 'Soft Focus'
]

function seedRandom(seedStr) {
  let h = 2166136261
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return () => {
    h += h << 13
    h ^= h >>> 7
    h += h << 3
    h ^= h >>> 17
    h += h << 5
    return ((h >>> 0) % 10000) / 10000
  }
}

function hashStr(s) {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 8)
}

function makeFiles(artist, album, genre, rand, count) {
  const files = []
  for (let i = 0; i < count; i++) {
    const trackName = TRACK_NAMES[Math.floor(rand() * TRACK_NAMES.length)]
    const flac = rand() > 0.35
    const extension = flac ? 'flac' : 'mp3'
    const bitrate = flac ? 1000 + Math.floor(rand() * 400) : 256 + Math.floor(rand() * 96)
    const length = 120 + Math.floor(rand() * 240)
    const filename = `${artist} - ${album} - ${String(i + 1).padStart(2, '0')} ${trackName}.${extension}`
    files.push({
      filename,
      size: Math.floor(length * bitrate * 1000 * (flac ? 4.2 : 1.0) / 8) + (i * 977),
      bitrate,
      length,
      sampleRate: flac ? 96000 : 44100,
      format: flac ? 'FLAC' : 'MP3'
    })
  }
  return files
}

class MockSoulseek {
  mode = 'mock'
  connected = true

  async search(query, limit = 50) {
    const q = query.trim().toLowerCase()
    const results = []
    for (const entry of CATALOG) {
      const haystack = `${entry.artist} ${entry.albums.join(' ')} ${entry.genre}`.toLowerCase()
      if (!q || haystack.includes(q)) {
        const rand = seedRandom(entry.artist + q)
        for (const album of entry.albums) {
          const files = makeFiles(entry.artist, album, entry.genre, rand, 8 + Math.floor(rand() * 5))
          results.push({
            username: `peer_${hashStr(entry.artist).slice(0, 8)}`,
            peerUploadSlots: true,
            uploadSpeed: 50 + Math.floor(rand() * 450),
            files: files.slice(0, 4)
          })
        }
      }
    }
    return results.slice(0, limit)
  }

  async status() {
    return { connected: true, mode: 'mock', username: 'mock-peer', slotFree: 3 }
  }

  async download() {
    return { id: crypto.randomUUID() }
  }

  async downloads() {
    return []
  }

  async browse(username, directory = '') {
    const q = (directory || '').toLowerCase()
    const files = []
    for (const entry of CATALOG) {
      const peer = `peer_${hashStr(entry.artist).slice(0, 8)}`
      if (peer !== username) continue
      const rand = seedRandom(entry.artist + q)
      for (const album of entry.albums) {
        if (q && !`${entry.artist} - ${album}`.toLowerCase().includes(q)) continue
        files.push(...makeFiles(entry.artist, album, entry.genre, rand, 8 + Math.floor(rand() * 5)))
      }
    }
    return { username, directory, files }
  }
}

/* ------------------------------------------------------------------ */
/* slskd backend: talks to a running slskd daemon via its REST API      */
/* ------------------------------------------------------------------ */

class SlskdSoulseek {
  mode = 'slskd'

  constructor() {
    this.baseUrl = config.slskd.baseUrl.replace(/\/$/, '')
    this._authHeaders = {}
    if (config.slskd.apiKey) this._authHeaders['X-API-Key'] = config.slskd.apiKey
    if (config.slskd.username && config.slskd.password) {
      this._authHeaders['Authorization'] = 'Basic ' + Buffer.from(`${config.slskd.username}:${config.slskd.password}`).toString('base64')
    }
    // Search dedup: a running search for the same query is shared (so parallel
    // track plays don't fire N identical slskd searches), and a recent result
    // is reused so repeated queries stop re-hitting the network.
    this._searchCache = new Map()
    this._searchCacheTtlMs = 15000
  }

  async _request(method, pathname, body) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30000)
    try {
      const res = await fetch(this.baseUrl + pathname, {
        method,
        headers: { 'Content-Type': 'application/json', ...this._authHeaders },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      })
      if (res.status === 204) return null
      const text = await res.text()
      if (!res.ok) throw new Error(`slskd ${method} ${pathname} -> ${res.status}: ${text.slice(0, 300)}`)
      return text ? JSON.parse(text) : null
    } finally {
      clearTimeout(timer)
    }
  }

  async status() {
    try {
      const app = await this._request('GET', '/api/v0/application')
      return {
        connected: app?.server?.isConnected ?? false,
        mode: 'slskd',
        username: app?.user?.username ?? null,
        server: app?.server?.ipEndPoint ?? ''
      }
    } catch {
      return { connected: false, mode: 'slskd', username: null, server: null }
    }
  }

  _normalizeFile(f) {
    const bitrate = f.bitrate || 0
    return {
      filename: f.filename,
      size: f.size,
      bitrate,
      bitDepth: f.bitDepth,
      length: f.length || (bitrate > 0 && f.sampleRate ? Math.round((f.size * 8) / (bitrate * 1000)) : null),
      sampleRate: f.sampleRate,
      format: (f.filename || '').split('.').pop().toUpperCase()
    }
  }

  async search(query, limit = 50) {
    const key = `q:${query}:${limit}`
    const cached = this._searchCache.get(key)
    if (cached) {
      // A search for this query is already running — share it instead of
      // posting a second (identical) slskd search.
      if (cached.promise) return cached.promise
      // A recent result for this query — reuse it.
      if (Date.now() - cached.at < this._searchCacheTtlMs) return cached.value
    }
    const promise = this._doSearch(query, limit)
      .then((value) => {
        this._searchCache.set(key, { promise: null, value, at: Date.now() })
        if (this._searchCache.size > 200) {
          const first = this._searchCache.keys().next().value
          this._searchCache.delete(first)
        }
        return value
      })
      .catch((err) => {
        this._searchCache.delete(key)
        throw err
      })
    this._searchCache.set(key, { promise, value: null, at: Date.now() })
    return promise
  }

  async _doSearch(query, limit = 50) {
    const { id } = await this._request('POST', '/api/v0/searches', {
      searchText: query,
      searchTimeout: config.soularr.searchTimeoutMs,
      filterResponses: true,
      maximumPeerQueueLength: config.soularr.maximumPeerQueueLength,
      minimumPeerUploadSpeed: config.soularr.minimumPeerUploadSpeed
    })
    // Poll for the network to return responses. Check immediately, then every
    // 700ms — most peers answer within a couple of seconds and waiting 1.5s
    // before the first check made every search/play feel unresponsive.
    let responses = []
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        responses = await this._request('GET', `/api/v0/searches/${id}/responses?filter=isCompleteFile==true`)
      } catch {
        responses = []
      }
      if (responses.length) break
      await new Promise((r) => setTimeout(r, 700))
    }
    const normalized = responses.map((r) => ({
      username: r.username,
      peerUploadSlots: r.hasFreeUploadSlot ?? r.isFreeUploadSlot,
      uploadSpeed: r.uploadSpeed || 0,
      files: (r.files || []).slice(0, 25).map((f) => this._normalizeFile(f))
    })).filter((r) => r.files.length > 0)
    return normalized.slice(0, limit)
  }

  async browse(username, directory) {
    const result = await this._request('POST', `/api/v0/users/${encodeURIComponent(username)}/directory`, { directory })
    const dirs = Array.isArray(result) ? result : [result]
    const d = dirs.find((x) => x && x.files) || dirs[0] || { files: [] }
    return {
      username,
      directory,
      files: (d.files || []).map((f) => this._normalizeFile(f))
    }
  }

  async download({ username, filename, size = 0 }) {
    const result = await this._request('POST', `/api/v0/transfers/downloads/${encodeURIComponent(username)}`, [{ filename, size }])
    return { id: result?.Enqueued?.[0]?.id ?? crypto.randomUUID() }
  }

  async downloads() {
    const list = await this._request('GET', '/api/v0/transfers/downloads')
    // grouped response: [{ username, directories: [{ directory, fileCount, files: [...] }] }]
    const flat = []
    for (const group of list || []) {
      for (const dir of group.directories || []) {
        for (const f of dir.files || []) {
          flat.push({
            username: group.username,
            filename: f.filename,
            size: f.size,
            bytesReceived: f.bytesTransferred,
            state: f.state,
            path: null
          })
        }
      }
    }
    return flat
  }
}

/* ------------------------------------------------------------------ */

export const soulseek = config.soulseekMode === 'slskd' ? new SlskdSoulseek() : new MockSoulseek()

/* ------------------------------------------------------------------ */
/* Mock audio synthesis (used only in mock mode when a download lands)  */
/* ------------------------------------------------------------------ */

export async function synthesizeMockTrack({ trackId, title, artist, album, duration, format = 'flac', outputPath = null }) {
  const seed = seedRandom(`${artist}-${title}-${trackId}`)
  const base = 200 + Math.floor(seed() * 400)
  const outFile = outputPath || path.join(ORIGINAL_DIR, `mock-${trackId}.${format}`)
  const args = [
    '-y', '-f', 'lavfi', '-i', `sine=frequency=${base}:duration=${duration}`,
    '-af', `volume=0.12,tremolo=f=${2 + seed() * 6}:d=0.8`,
    '-metadata', `title=${title}`,
    '-metadata', `artist=${artist}`,
    '-metadata', `album=${album}`,
    '-metadata', `track=${Math.floor(seed() * 12) + 1}`,
    '-metadata', `genre=${seed() > 0.5 ? 'Electronic' : 'Rock'}`
  ]
  if (format === 'flac') args.push('-c:a', 'flac', outFile)
  else args.push('-codec:a', 'libmp3lame', '-b:a', '256k', outFile)
  await pExec('ffmpeg', args)
  return outFile
}

export function isMockMode() {
  return config.soulseekMode === 'mock'
}
