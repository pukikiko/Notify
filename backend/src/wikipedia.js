/**
 * Wikipedia enrichment: the lead-section extract (bio) and the lead image
 * (artwork) for an artist, used on the home showcase and artist pages.
 *
 * Traffic to Wikimedia is kept to a minimum because they rate-limit heavily:
 *  - two-layer cache: an in-memory map plus an on-disk JSON cache under
 *    {CACHE_DIR}/wiki that survives restarts, so the same artist is never
 *    re-fetched after a reboot
 *  - long TTLs and negative caching — artists with no article are cached too,
 *    so they are never re-asked
 *  - every request carries the headers Wikimedia requires/expects
 *    (descriptive User-Agent, gzip) and the maxlag query parameter
 *  - requests are serialized (never concurrent), which the API etiquette
 *    explicitly calls for
 *  - 429/503 responses honor Retry-After and fall back to exponential
 *    backoff; total failures serve the stale cached copy when one exists
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { config, CACHE_DIR } from './config.js'

const API = 'https://en.wikipedia.org/w/api.php'
const WIKI_CACHE_DIR = path.join(CACHE_DIR, 'wiki')
fs.mkdirSync(WIKI_CACHE_DIR, { recursive: true })

const TTL = config.wikipedia.cacheTtlDays * 24 * 60 * 60 * 1000
const MISS_TTL = config.wikipedia.missTtlHours * 60 * 60 * 1000
// transient network/HTTP failures are remembered only in memory for a short
// cooldown so a burst of failures doesn't hammer the API
const ERROR_COOLDOWN = 2 * 60 * 1000
const TIMEOUT_MS = 8000
// polite maxlag value per the API etiquette docs
const MAXLAG = config.wikipedia.maxlag
const MAX_BACKOFF_MS = 8000

const CACHE = new Map()
const MAX_MEMORY_ENTRIES = 5000
const inflight = new Map()

let serialQueue = Promise.resolve()
/** Run tasks strictly one at a time; the queue survives task rejections. */
function enqueue(task) {
  const run = serialQueue.then(task, task)
  serialQueue = run.catch(() => {})
  return run
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function isWebImage(url) {
  return /\.(jpe?g|png|gif|webp|svg)$/i.test((url || '').split('?')[0])
}

function isFresh(entry) {
  const ttl = entry.kind === 'ok' ? TTL : entry.kind === 'missing' ? MISS_TTL : ERROR_COOLDOWN
  return Date.now() - entry.t < ttl
}

function remember(key, entry) {
  CACHE.set(key, entry)
  if (CACHE.size > MAX_MEMORY_ENTRIES) {
    const oldest = CACHE.keys().next().value
    CACHE.delete(oldest)
  }
}

function diskPath(key) {
  const hash = crypto.createHash('sha1').update(key).digest('hex')
  return path.join(WIKI_CACHE_DIR, `${hash}.json`)
}

function readDisk(key) {
  try {
    const entry = JSON.parse(fs.readFileSync(diskPath(key), 'utf8'))
    return entry && typeof entry.t === 'number' ? entry : null
  } catch {
    return null
  }
}

function writeDisk(key, entry) {
  if (entry.kind === 'error') return
  try {
    fs.writeFileSync(diskPath(key), JSON.stringify(entry))
  } catch (err) {
    console.warn(`[wikipedia] disk cache write failed: ${err.message}`)
  }
}

function extractPage(data) {
  const pages = data?.query?.pages || []
  const page = pages.find((p) => p && !p.missing)
  if (!page) return null
  const extract = (page.extract || '').trim().replace(/\s+/g, ' ')
  // Wikipedia's thumbnail service transcodes to a browser-friendly format
  // (JPEG/PNG); `original` can be a TIF or other format browsers can't
  // render, so only fall back to it when no thumbnail exists.
  const thumb = page.thumbnail?.source || null
  const orig = page.original?.source || null
  const image = thumb || (orig && isWebImage(orig) ? orig : null)
  if (!extract && !image) return null
  return { title: page.title, extract: extract || null, image }
}

async function request(name) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    redirects: '1',
    maxlag: String(MAXLAG),
    prop: 'extracts|pageimages',
    exintro: '1',
    explaintext: '1',
    exsentences: '4',
    piprop: 'original|thumbnail',
    pithumbsize: '1000',
    titles: name
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(`${API}?${params}`, {
      signal: controller.signal,
      headers: {
        // Required by Wikimedia's User-Agent policy — a descriptive UA with
        // contact info is mandatory and throttled/blocked without one.
        'User-Agent': config.wikipedia.userAgent,
        // Reduce bandwidth; also lets the API know we speak gzip.
        'Accept-Encoding': 'gzip'
      }
    })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchArtist(key, name, stale) {
  let attempt = 0
  while (true) {
    try {
      const res = await request(name)
      if (res.ok) {
        const entry = { t: Date.now(), kind: 'ok', v: extractPage(await res.json()) }
        if (!entry.v) entry.kind = 'missing'
        remember(key, entry)
        writeDisk(key, entry)
        return entry.v
      }

      // 429 Too Many Requests / 503 (maxlag) — back off, honoring Retry-After
      if (res.status === 429 || res.status === 503) {
        const retryAfter = Number(res.headers.get('retry-after'))
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 60 * 1000)
          : Math.min(500 * 2 ** attempt, MAX_BACKOFF_MS)
        console.warn(`[wikipedia] "${name}" throttled (HTTP ${res.status}), retrying in ${Math.round(delay / 1000)}s`)
        await sleep(delay)
        attempt++
        continue
      }

      throw new Error(`HTTP ${res.status}`)
    } catch (err) {
      if (attempt >= 5) {
        console.warn(`[wikipedia] "${name}" failed: ${err.message}`)
        if (stale && isFresh(stale)) return stale.v
        const entry = { t: Date.now(), kind: 'error', v: null }
        remember(key, entry)
        return null
      }
      await sleep(Math.min(500 * 2 ** attempt, MAX_BACKOFF_MS))
      attempt++
    }
  }
}

export async function wikiArtist(name) {
  if (!name) return null
  const key = name.toLowerCase().trim()
  const original = name.trim()

  const hit = CACHE.get(key)
  if (hit && isFresh(hit)) return hit.v

  const disk = readDisk(key)
  if (disk && isFresh(disk)) {
    remember(key, disk)
    return disk.v
  }

  // Coalesce concurrent lookups for the same artist into one request.
  if (inflight.has(key)) return inflight.get(key)
  const p = enqueue(() => fetchArtist(key, original, disk))
  inflight.set(key, p)
  try {
    return await p
  } finally {
    inflight.delete(key)
  }
}
