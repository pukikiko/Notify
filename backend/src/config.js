import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(__dirname, '..')
export const DATA_DIR = process.env.DATA_DIR || path.resolve(ROOT, '../data')
export const CACHE_DIR = path.join(DATA_DIR, 'cache')
export const ORIGINAL_DIR = path.join(CACHE_DIR, 'original')
export const TRANSCODED_DIR = path.join(CACHE_DIR, 'transcoded')
export const ART_DIR = path.join(CACHE_DIR, 'art')
// where slskd writes partial Soulseek transfers before moving them to ORIGINAL_DIR
export const INCOMPLETE_DIR = process.env.SLSKD_INCOMPLETE_DIR || path.join(CACHE_DIR, 'incomplete')
export const DB_PATH = path.join(DATA_DIR, 'notify.db')

export const config = {
  port: Number(process.env.PORT || 4000),
  // soulseek mode: 'mock' (no network, synthesized audio) or 'slskd' (real network via slskd daemon)
  soulseekMode: process.env.SOULSEEK_MODE || 'mock',
  slskd: {
    baseUrl: process.env.SLSKD_URL || 'http://127.0.0.1:5030',
    apiKey: process.env.SLSKD_API_KEY || '',
    username: process.env.SLSKD_API_USERNAME || '',
    password: process.env.SLSKD_API_PASSWORD || '',
    // if a queued Soulseek transfer hasn't started within this window, the
    // source is abandoned — the next-best Soulseek candidate is tried, and
    // only once those are exhausted does the track fall back to YouTube Music
    downloadStartTimeoutMs: Number(process.env.SLSKD_DOWNLOAD_START_TIMEOUT_MS || 60000),
    // if a transfer reports "Completed, Succeeded" but its file never shows up
    // in the cache within this window, the source is treated as failed and the
    // next-best candidate is tried
    completeMissingTimeoutMs: Number(process.env.SLSKD_COMPLETE_MISSING_TIMEOUT_MS || 30000)
  },
  spotify: {
    // Client Credentials from the Spotify Developer dashboard — used for all
    // discovery/enrichment (search, artwork, artist info). Audio is never
    // fetched from Spotify; it only resolves metadata.
    clientId: process.env.SPOTIFY_CLIENT_ID || '',
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET || ''
  },
  discover: {
    // Spotify's fuzzy search returns *something* for almost any query, even
    // when it doesn't actually have the track. A search is only counted as
    // "found on Spotify" when the top results cover at least this fraction of
    // the query's significant tokens; below it we treat it as a miss and fall
    // back to the Soulseek catalog + YouTube Music/SoundCloud.
    coverageMin: Number(process.env.DISCOVER_COVERAGE_MIN || 0.8)
  },
  youtube: {
    // fallback source: yt-dlp pulls audio from YouTube (Music) when a track
    // can't be found on Soulseek. Set YOUTUBE_ENABLED=false to disable.
    enabled: process.env.YOUTUBE_ENABLED !== 'false',
    // path to the yt-dlp binary (shared by all web providers)
    binary: process.env.YTDLP_PATH || 'yt-dlp',
    // search engine prefix: 'ytsearch' (default, most reliable) or 'ytmsearch'
    // where the installed yt-dlp supports it
    searchEngine: process.env.YTDLP_SEARCH || 'ytsearch',
    // how many candidate results to evaluate per search
    maxResults: Number(process.env.YTDLP_MAX_RESULTS || 6),
    // network timeout for a single search/extract call
    timeoutMs: Number(process.env.YTDLP_TIMEOUT_MS || 30000),
    // generous timeout for the actual audio download
    downloadTimeoutMs: Number(process.env.YTDLP_DOWNLOAD_TIMEOUT_MS || 600000)
  },
  soundcloud: {
    // second web fallback source: yt-dlp's scsearch pulls audio from
    // SoundCloud when neither Soulseek nor YouTube Music can find a track.
    // Set SOUNDCLOUD_ENABLED=false to disable.
    enabled: process.env.SOUNDCLOUD_ENABLED !== 'false',
    // how many candidate results to evaluate per search
    maxResults: Number(process.env.SOUNDCLOUD_MAX_RESULTS || 6),
    // network timeout for a single search/extract call
    timeoutMs: Number(process.env.SOUNDCLOUD_TIMEOUT_MS || 30000),
    // generous timeout for the actual audio download
    downloadTimeoutMs: Number(process.env.SOUNDCLOUD_DOWNLOAD_TIMEOUT_MS || 600000)
  },
  mock: {
    // how many seconds of synthesized audio per mock track
    duration: Number(process.env.MOCK_DURATION || 45),
    // how long a mock "download" takes in ms
    downloadDelayMs: Number(process.env.MOCK_DOWNLOAD_MS || 2500)
  },
  // Soularr's Soulseek search & selection settings (mirrors Soularr config.ini)
  soularr: {
    // a track must score above this to be considered a match
    minimumMatchRatio: Number(process.env.SOULAR_MIN_MATCH_RATIO || 0.8),
    // a candidate file/directory must mention the artist at least this well;
    // stops matching a same-titled file from a different artist
    minimumArtistScore: Number(process.env.SOULAR_MIN_ARTIST_SCORE || 0.6),
    // quality tiers tried in order; first tier with a match wins
    allowedFiletypes: (process.env.SOULAR_ALLOWED_FILETYPES || 'flac 24/192,flac 16/44.1,flac,mp3 320,mp3')
      .split(',').map((s) => s.trim()).filter(Boolean),
    // prepend the artist to the search query so results are artist-relevant
    prependArtist: process.env.SOULAR_PREPEND_ARTIST !== 'false',
    // peers never selected as download sources
    ignoredUsers: (process.env.SOULAR_IGNORED_USERS || '').split(',').map((s) => s.trim()).filter(Boolean),
    // words stripped out of search queries
    searchBlacklist: (process.env.SOULAR_SEARCH_BLACKLIST || '').split(',').map((s) => s.trim()).filter(Boolean),
    // slskd search collection window (ms) before results are polled
    searchTimeoutMs: Number(process.env.SOULAR_SEARCH_TIMEOUT_MS || 5000),
    // peers with a longer queue than this are skipped
    maximumPeerQueueLength: Number(process.env.SOULAR_MAX_PEER_QUEUE || 50),
    // peers with a slower average upload than this (kbps) are skipped
    minimumPeerUploadSpeed: Number(process.env.SOULAR_MIN_PEER_UPLOAD_SPEED || 0),
    // assumed upload speed (kbps) for peers that don't advertise one; used
    // when ranking candidates by expected download time
    assumedUploadSpeedKbps: Number(process.env.SOULAR_ASSUMED_UPLOAD_SPEED_KBPS || 100),
    // how many additional Soulseek candidates are kept as fallbacks when the
    // best download fails, before falling back to YouTube Music/SoundCloud
    maxAlternateSources: Number(process.env.SOULAR_MAX_ALTERNATE_SOURCES || 5),
    // when a candidate reports a track length, only accept it if it's within
    // this many seconds of the expected (Spotify) duration — stops a live /
    // remix / extended version from being picked over the album track
    maxDurationDifference: Number(process.env.SOULAR_MAX_DURATION_DIFFERENCE || 3)
  }
}

export const FORMATS = {
  original: { label: 'Super High Quality (Original Quality)', mime: 'application/octet-stream', ext: null },
  'opus-160': { label: 'High Quality (Opus 160kbps)', mime: 'audio/ogg', ext: 'ogg' },
  'opus-96': { label: 'Medium Quality (Opus 96kbps)', mime: 'audio/ogg', ext: 'ogg' }
}

export function formatInfo(format) {
  return FORMATS[format] || FORMATS.original
}
