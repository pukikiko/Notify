import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import { db } from './db.js'
import { ORIGINAL_DIR, INCOMPLETE_DIR, TRANSCODED_DIR, formatInfo } from './config.js'
import { encodeArgs } from './transcoder.js'

/**
 * Real-time streaming while a download is still in progress.
 *
 * slskd, yt-dlp and the mock synthesizer all write their partial results to
 * disk as they go (incomplete/ dir, `*.part` files, tmp-* files) and only
 * rename/ingest the file once the download is complete. This module watches
 * those growing files, feeds them into a live ffmpeg transcode (when the
 * client wants a different format), and serves the growing output to the
 * client — so playback starts as soon as the first decodable audio exists
 * instead of waiting for the whole download.
 */

const POLL_MS = 400
const MAX_CHUNK = 256 * 1024
const LIVE_NAMESPACE = 'live-'
const CLEANUP_DELAY_MS = 60_000

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function fileSize(p) {
  try {
    const s = fs.statSync(p)
    return s.isFile() ? s.size : -1
  } catch {
    return -1
  }
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

/** Recursively find every file in `dir` with the given basename. slskd writes
    partial transfers nested under incomplete/<username>/<remote path>/, so a
    flat lookup would never see them. */
function findFilesByBasename(dir, base) {
  const found = []
  const walk = (d) => {
    let entries = []
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name === base) found.push(p)
    }
  }
  walk(dir)
  return found
}

/* ------------------------------------------------------------------ */
/* GrowingFileReader                                                   */
/* ------------------------------------------------------------------ */

/**
 * A Readable that reads a file which an external process is still writing
 * to. It follows the file's growth, and if the file is renamed mid-download
 * (e.g. `<name>.part` -> `<name>`, or `incomplete/` -> `original/`), it
 * transparently continues from the next candidate path that has content
 * beyond the read offset. When `done()` reports the source will never grow
 * again, the reader drains whatever remains and then ends.
 */
export class GrowingFileReader extends Readable {
  /**
   * @param {object} opts
   * @param {string[] | (() => string[])} opts.candidates paths in priority
   *   order; a function is re-evaluated whenever the reader needs to find
   *   a file (so renames and newly-appearing files are picked up).
   * @param {() => boolean} opts.done true once the source will never grow.
   * @param {number} [opts.pollMs] how often to re-check for growth/renames.
   * @param {number} [opts.offset] byte offset to start reading from.
   * @param {number} [opts.max] exclusive byte offset to stop at (for Range).
   */
  constructor({ candidates, done, pollMs = POLL_MS, offset = 0, max = null }) {
    super()
    this.resolve = Array.isArray(candidates) ? () => candidates : candidates
    this.done = done
    this.pollMs = pollMs
    this.offset = offset
    this.max = max
    this.fd = null
    this.currentPath = null
    this._busy = false
  }

  _pick() {
    const seen = new Set()
    const paths = this.resolve().filter((p) => p && !seen.has(p) && seen.add(p))
    for (const p of paths) {
      const size = fileSize(p)
      // Strictly greater: a file at the current offset has nothing new to read,
      // so it must not be re-opened forever — the caller falls through to the
      // done()/poll decision instead.
      if (size > this.offset) return { p, size }
    }
    return null
  }

  _read() {
    if (this._busy) return
    this._busy = true
    this._loop()
      .catch((err) => this.destroy(err))
      .finally(() => {
        this._busy = false
      })
  }

  async _loop() {
    for (;;) {
      if (this.destroyed) return
      if (this.max != null && this.offset >= this.max) {
        this.push(null)
        return
      }
      if (!this.fd) {
        const hit = this._pick()
        if (!hit) {
          if (this.done()) {
            this.push(null)
            return
          }
          await sleep(this.pollMs)
          continue
        }
        try {
          this.fd = fs.openSync(hit.p, 'r')
          this.currentPath = hit.p
        } catch {
          await sleep(this.pollMs)
          continue
        }
        continue
      }
      const { bytesRead, buf } = await this._readChunk()
      if (bytesRead > 0) {
        this.offset += bytesRead
        if (!this.push(buf.subarray(0, bytesRead))) return
        continue
      }
      // EOF on the current fd — the file may have grown or been renamed.
      this._closeFd()
      if (this._pick()) continue
      if (this.done()) {
        this.push(null)
        return
      }
      await sleep(this.pollMs)
    }
  }

  _readChunk() {
    const buf = Buffer.alloc(MAX_CHUNK)
    return new Promise((resolve) => {
      fs.read(this.fd, buf, 0, buf.length, this.offset, (err, bytesRead) => {
        if (err) return resolve({ bytesRead: 0, buf })
        resolve({ bytesRead, buf })
      })
    })
  }

  _closeFd() {
    try {
      if (this.fd) fs.closeSync(this.fd)
    } catch { /* ignore */ }
    this.fd = null
    this.currentPath = null
  }

  _destroy(err, cb) {
    this._closeFd()
    cb(err)
  }
}

/* ------------------------------------------------------------------ */
/* locating the growing source file for a track                         */
/* ------------------------------------------------------------------ */

function currentDownload(trackId) {
  return db.prepare("SELECT * FROM downloads WHERE track_id = ? AND status != 'complete' ORDER BY id DESC LIMIT 1").get(trackId) || null
}

/** Signature of the active download; changes when failover switches source. */
function downloadSignature(trackId) {
  const d = currentDownload(trackId)
  if (!d) return null
  return `${d.id}:${d.provider}:${d.username}:${d.filename}`
}

/**
 * Candidate paths (most-recently-being-written first) for a track that is
 * still downloading, across every provider:
 *   - soulseek:  incomplete/<name> (growing) -> original/<name> -> <id>.<ext>
 *   - web:       original/web-<id>.<ext>.part (growing) -> original/web-<id>.<ext> -> <id>.<ext>
 *   - mock:      original/tmp-<id>.flac (growing) -> <id>.<ext>
 */
export function sourceCandidates(trackId) {
  const row = db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId)
  if (!row) return []
  const d = currentDownload(trackId)
  const out = []
  if (d?.filename) {
    const base = d.filename.split(/[\\/]/).pop()
    if (base) {
      // slskd writes partials nested under incomplete/<username>/<remote path>/;
      // the completed file is moved flat into original/. Prefer the growing
      // partial first so live streaming reads it as the download progresses.
      out.push(...findFilesByBasename(INCOMPLETE_DIR, base))
      out.push(path.join(ORIGINAL_DIR, base))
    }
  }
  // web (yt-dlp) partial/final files and mock synthesizer output
  for (const n of listDir(ORIGINAL_DIR)) {
    if (n.startsWith(`web-${trackId}.`) && !n.endsWith('.ytdl')) out.push(path.join(ORIGINAL_DIR, n))
    if (n === `tmp-${trackId}.flac`) out.push(path.join(ORIGINAL_DIR, n))
    if (n.startsWith(`${trackId}.`)) out.push(path.join(ORIGINAL_DIR, n))
  }
  if (row.source_path) out.push(row.source_path)
  return out
}

/** True once the track is no longer downloading (ingested or failed) or the
    active download source has changed (failover abandoned it). */
export function trackDone(trackId) {
  const sig = downloadSignature(trackId)
  return () => {
    const t = db.prepare('SELECT status FROM tracks WHERE id = ?').get(trackId)
    if (!t || t.status !== 'downloading') return true
    return downloadSignature(trackId) !== sig
  }
}

/** Largest byte count currently available across the candidate paths. */
export function availableSize(trackId) {
  let max = 0
  for (const p of sourceCandidates(trackId)) {
    const s = fileSize(p)
    if (s > max) max = s
  }
  return max
}

/* ------------------------------------------------------------------ */
/* live transcode sessions                                             */
/* ------------------------------------------------------------------ */

const sessions = new Map()

const sessionKey = (trackId, format) => `${trackId}:${format}`

class LiveSession extends EventEmitter {
  constructor(trackId, format) {
    super()
    this.trackId = trackId
    this.format = format
    this.state = 'starting'
    this.outputPath = path.join(TRANSCODED_DIR, `${LIVE_NAMESPACE}${trackId}-${format}.${formatInfo(format).ext}`)
    this.readers = new Set()
    this._cleanupTimer = null
  }

  start() {
    try {
      fs.unlinkSync(this.outputPath)
    } catch { /* no stale output */ }
    const input = new GrowingFileReader({
      candidates: () => sourceCandidates(this.trackId),
      done: trackDone(this.trackId)
    })
    const spec = encodeArgs(this.format)
    if (!spec) {
      this._finish('failed')
      return
    }
    const proc = spawn('ffmpeg', ['-y', '-i', 'pipe:0', '-map', '0:a:0', ...spec.args, this.outputPath], {
      stdio: ['pipe', 'ignore', 'pipe']
    })
    this.proc = proc
    this.input = input
    let errTail = ''
    proc.stderr.on('data', (d) => {
      errTail = (errTail + String(d)).slice(-2000)
    })
    proc.on('error', (err) => {
      console.error('[progressive] ffmpeg spawn failed', err.message)
      this._finish('failed')
    })
    proc.on('close', (code) => {
      if (code === 0 && fileSize(this.outputPath) > 0) {
        this._finish('finished')
      } else {
        if (code !== 0) console.error('[progressive] ffmpeg exited', code, errTail)
        this._finish('failed')
      }
    })
    input.on('error', (err) => {
      console.error('[progressive] source reader failed', err.message)
      try {
        proc.stdin.destroy()
      } catch { /* ignore */ }
    })
    input.pipe(proc.stdin)
    this._scheduleCleanup()
  }

  _finish(state) {
    if (this.state === 'finished' || this.state === 'failed') return
    this.state = state
    this.emit('state', state)
    this._scheduleCleanup()
  }

  addReader(reader) {
    this.readers.add(reader)
    reader.on('close', () => {
      this.readers.delete(reader)
      this._scheduleCleanup()
    })
  }

  _scheduleCleanup() {
    if (this._cleanupTimer) clearTimeout(this._cleanupTimer)
    if (this.state !== 'finished' && this.state !== 'failed') return
    this._cleanupTimer = setTimeout(() => {
      if (this.readers.size > 0) return
      try {
        fs.unlinkSync(this.outputPath)
      } catch { /* already gone */ }
      sessions.delete(sessionKey(this.trackId, this.format))
    }, CLEANUP_DELAY_MS)
  }
}

/** Get (creating if needed) the live transcode session for a downloading
    track + format. The temp output file is written by ffmpeg as the source
    downloads and is served to clients as it grows. */
export function getLiveSession(trackId, format) {
  const key = sessionKey(trackId, format)
  let session = sessions.get(key)
  if (session) return session
  session = new LiveSession(trackId, format)
  sessions.set(key, session)
  session.start()
  return session
}

/* ------------------------------------------------------------------ */
/* serving growing files                                               */
/* ------------------------------------------------------------------ */

/** Serve a growing file (source or transcode output) to the client.
    Range requests are honoured over whatever bytes exist so far (browsers,
    especially iOS, use them for progressive playback); a plain GET streams
    chunked from the start and follows the file as it grows. */
export function serveGrowing(req, res, { candidates, done, mime, knownTotal = null }) {
  const avail = Math.max(0, ...candidates().map(fileSize))
  const range = req.headers.range
  if (range && avail > 0) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    const start = m && m[1] !== undefined && m[1] !== '' ? parseInt(m[1], 10) : 0
    const endRaw = m && m[2] !== undefined && m[2] !== '' ? parseInt(m[2], 10) : null
    if (!isNaN(start) && start >= 0 && start < avail) {
      const end = Math.min(endRaw ?? avail - 1, avail - 1)
      res.writeHead(206, {
        'Content-Type': mime,
        'Content-Range': `bytes ${start}-${end}/${knownTotal ?? '*'}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Cache-Control': 'no-store'
      })
      const reader = new GrowingFileReader({ candidates, done, offset: start, max: end + 1 })
      reader.pipe(res)
      return
    }
    res.writeHead(416, { 'Content-Range': `bytes */${knownTotal ?? '*'}` })
    return res.end()
  }
  res.writeHead(200, {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store'
  })
  const reader = new GrowingFileReader({ candidates, done })
  reader.pipe(res)
}

/** Serve a live transcode session's growing output to the client. */
export function serveLiveTranscode(req, res, { trackId, format }) {
  const session = getLiveSession(trackId, format)
  if (session.state === 'failed') {
    return res.status(500).json({ error: 'Live transcode failed' })
  }
  const mime = formatInfo(format).mime
  const avail = fileSize(session.outputPath)
  const done = () => session.state === 'finished' || session.state === 'failed'
  const range = req.headers.range
  if (range && avail > 0) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    const start = m && m[1] !== undefined && m[1] !== '' ? parseInt(m[1], 10) : 0
    const endRaw = m && m[2] !== undefined && m[2] !== '' ? parseInt(m[2], 10) : null
    if (!isNaN(start) && start >= 0 && start < avail) {
      const end = Math.min(endRaw ?? avail - 1, avail - 1)
      res.writeHead(206, {
        'Content-Type': mime,
        'Content-Range': `bytes ${start}-${end}/*`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Cache-Control': 'no-store'
      })
      const reader = new GrowingFileReader({ candidates: [session.outputPath], done, offset: start, max: end + 1 })
      session.addReader(reader)
      reader.pipe(res)
      return
    }
    res.writeHead(416, { 'Content-Range': 'bytes */*' })
    return res.end()
  }
  res.writeHead(200, {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store'
  })
  const reader = new GrowingFileReader({ candidates: [session.outputPath], done })
  session.addReader(reader)
  reader.pipe(res)
}

/* ------------------------------------------------------------------ */
/* startup cleanup of stale live transcode files                       */
/* ------------------------------------------------------------------ */

try {
  for (const f of listDir(TRANSCODED_DIR)) {
    if (f.startsWith(LIVE_NAMESPACE)) {
      try {
        fs.unlinkSync(path.join(TRANSCODED_DIR, f))
      } catch { /* ignore */ }
    }
  }
} catch { /* ignore */ }
