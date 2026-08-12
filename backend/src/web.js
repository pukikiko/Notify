import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'

/**
 * Web providers (YouTube Music, SoundCloud) via yt-dlp. Used as failover
 * sources when a track cannot be found on Spotify/Soulseek: we search the
 * provider, rank the candidates, and download the best match as an audio
 * file for the shared cache. Metadata (title/artist/duration/thumbnail)
 * comes straight from each platform's search results.
 */

const pExec = (args, opts = {}) =>
  new Promise((resolve, reject) => {
    execFile(config.youtube.binary, args, { maxBuffer: 64 * 1024 * 1024, timeout: config.youtube.timeoutMs, ...opts }, (err, stdout, stderr) =>
      err ? reject(new Error(`${stderr || stdout}`.trim().slice(0, 400) || `${config.youtube.binary} exited ${err.code}`)) : resolve(stdout)
    )
  })

export function youtubeEnabled() {
  return config.youtube.enabled
}

export function soundcloudEnabled() {
  return config.soundcloud.enabled
}

export function webSourceEnabled() {
  return config.youtube.enabled || config.soundcloud.enabled
}

function norm(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/* ------------------------------------------------------------------ */
/* search                                                              */
/* ------------------------------------------------------------------ */

const CLUTTER = ['lyric', 'karaoke', 'live', 'cover', 'remix', 'instrumental', 'tribute', 'reaction', 'trailer', 'with lyrics', 'official video', 'official audio', 'radio edit', 'extended mix', 'club mix', 'original mix']

function entryClutterScore(entry) {
  const haystack = norm(`${entry.title || ''} ${entry.description || ''}`)
  return CLUTTER.reduce((n, w) => (haystack.includes(w) ? n + 1 : n), 0)
}

function titleMatch(filename, title) {
  if (!title) return 0
  const nf = norm(filename)
  const nt = norm(title)
  if (!nt) return 0
  if (nf === nt) return 100
  if (nf.includes(nt)) return 85
  if (nt.includes(nf)) return 75
  const words = nt.split(' ').filter((w) => w.length > 3)
  const hits = words.filter((w) => nf.includes(w)).length
  return words.length ? (hits / words.length) * 50 : 0
}

function scoreEntry(entry, { artist, title, duration }) {
  let s = titleMatch(entry.title || '', title)
  if (!s) return 0
  const channel = norm(entry.channel || entry.uploader || '')
  if (artist && channel && (channel.includes(norm(artist)) || norm(artist).includes(channel))) s += 15
  if (entry.duration && duration) {
    const drift = Math.abs(entry.duration - duration)
    if (drift <= 10) s += 20
    else if (drift <= 30) s += 8
    else if (drift > 120) s -= 25
  } else if (!entry.duration) {
    s -= 5
  }
  s -= entryClutterScore(entry) * 18
  if (entry.channel_is_verified) s += 5
  if (entry.view_count) s += Math.min(5, Math.log10(entry.view_count + 1))
  return s
}

/** Prefer a mid-sized thumbnail (good for the UI) falling back to the largest. */
function pickThumbnail(entry) {
  const list = Array.isArray(entry.thumbnails) ? entry.thumbnails : []
  if (!list.length && entry.thumbnail) list.push({ url: entry.thumbnail })
  if (!list.length) return null
  const withWidth = list.filter((t) => t && t.url && t.width)
  const sorted = (withWidth.length ? withWidth : list).slice().sort((a, b) => (b.width || 0) - (a.width || 0))
  const mid = sorted.find((t) => t.width >= 300 && t.width <= 800)
  return (mid || sorted[0] || {}).url || null
}

const PROVIDERS = {
  youtubemusic: {
    enabled: () => config.youtube.enabled,
    prefix: () => config.youtube.searchEngine,
    maxResults: () => config.youtube.maxResults,
    timeoutMs: () => config.youtube.timeoutMs
  },
  soundcloud: {
    enabled: () => config.soundcloud.enabled,
    prefix: () => 'scsearch',
    maxResults: () => config.soundcloud.maxResults,
    timeoutMs: () => config.soundcloud.timeoutMs
  }
}

/**
 * Search a single web provider for matches of a track. Resolves to an array
 * of { provider, url, title, artist, duration, thumbnail } ranked by how well
 * each candidate matches, limited to `limit` results at or above `minScore`.
 * `query` overrides the auto-built "<artist> <title>" query for free-text
 * fallback searches; `minScore` lowers/raises the match bar.
 */
export async function searchTracks({ artist, album, title, duration, query, minScore = 25 }, providerName, limit = 1) {
  const cfg = PROVIDERS[providerName]
  if (!cfg || !cfg.enabled()) return []
  const q = (query && query.trim()) ? query.trim() : [artist, album, title].filter(Boolean).join(' ')
  if (!q.trim()) return []
  const prefix = `${cfg.prefix()}${cfg.maxResults()}:`
  const raw = await pExec(['-J', '--no-playlist', '--flat-playlist', prefix + q], { timeout: cfg.timeoutMs() })
  let entries = []
  try {
    entries = JSON.parse(raw).entries || []
  } catch {
    return []
  }
  const candidates = entries
    .filter((e) => e && e.id && e.url && (e.title || e.duration) && e.ie_key !== 'YoutubeTab')
    .map((e) => ({
      url: e.url,
      title: e.title || '',
      artist: e.artist || e.uploader || e.channel || null,
      duration: e.duration || null,
      channelIsVerified: !!e.channel_is_verified,
      viewCount: e.view_count || 0,
      description: e.description || '',
      thumbnail: pickThumbnail(e)
    }))
  if (!candidates.length) return []

  candidates.sort((a, b) => scoreEntry(b, { artist, title, duration }) - scoreEntry(a, { artist, title, duration }))
  return candidates
    .filter((c) => scoreEntry(c, { artist, title, duration }) >= minScore)
    .slice(0, limit)
    .map((best) => ({
      provider: providerName,
      url: best.url,
      title: best.title,
      artist: best.artist,
      duration: best.duration,
      thumbnail: best.thumbnail
    }))
}

/** Best single match for a track, or null when nothing clears the bar. */
export async function searchTrack(opts, providerName) {
  const [best] = await searchTracks(opts, providerName, 1)
  return best || null
}

export function searchYtMusic(opts) {
  return searchTrack(opts, 'youtubemusic')
}

export function searchSoundCloud(opts) {
  return searchTrack(opts, 'soundcloud')
}

export function searchYtMusicTracks(opts, limit = 8) {
  return searchTracks(opts, 'youtubemusic', limit)
}

export function searchSoundCloudTracks(opts, limit = 8) {
  return searchTracks(opts, 'soundcloud', limit)
}

/* ------------------------------------------------------------------ */
/* download                                                            */
/* ------------------------------------------------------------------ */

/**
 * Download a web URL's best audio stream to `outputBase` + actual extension
 * (e.g. outputBase.webm / outputBase.m4a). Returns the real file path.
 */
export async function downloadWeb(url, outputBase, { timeoutMs } = {}) {
  if (!url) throw new Error('no url to download')
  const args = [
    // Prefer streamable containers (webm/ogg) so the partial file can be fed
    // to the transcoder in real time while yt-dlp is still downloading; m4a
    // keeps its trailing moov atom and only decodes once the file completes.
    '-f', 'bestaudio[ext=webm]/bestaudio[ext=ogg]/bestaudio[ext=m4a]/bestaudio/best',
    '--no-playlist',
    '--no-progress',
    '-o', `${outputBase}.%(ext)s`,
    url
  ]
  await pExec(args, { timeout: timeoutMs || config.youtube.downloadTimeoutMs })
  const dir = path.dirname(outputBase)
  const stem = path.basename(outputBase)
  let found = null
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(stem) && path.extname(name)) {
      const p = path.join(dir, name)
      if (fs.statSync(p).size > 0) found = p
    }
  }
  if (!found) throw new Error(`yt-dlp produced no output file for ${url}`)
  return found
}
