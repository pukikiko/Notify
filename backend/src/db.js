import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { DB_PATH, ORIGINAL_DIR, TRANSCODED_DIR, ART_DIR, INCOMPLETE_DIR, CACHE_DIR } from './config.js'

for (const dir of [CACHE_DIR, ORIGINAL_DIR, INCOMPLETE_DIR, TRANSCODED_DIR, ART_DIR]) {
  fs.mkdirSync(dir, { recursive: true })
}
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

export const db = new DatabaseSync(DB_PATH)

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    settings TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS artists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    mbid TEXT,
    image TEXT,
    genres TEXT DEFAULT '[]',
    similar TEXT DEFAULT '[]',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS albums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    artist_id INTEGER REFERENCES artists(id) ON DELETE SET NULL,
    mbid TEXT,
    year INTEGER,
    image TEXT,
    genres TEXT DEFAULT '[]',
    created_at INTEGER NOT NULL,
    UNIQUE(title, artist_id)
  );

  CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    artist_id INTEGER REFERENCES artists(id) ON DELETE SET NULL,
    album_id INTEGER REFERENCES albums(id) ON DELETE SET NULL,
    track_no INTEGER,
    disc_no INTEGER,
    duration INTEGER,
    bitrate INTEGER,
    source_format TEXT,
    size INTEGER,
    mbid TEXT,
    genres TEXT DEFAULT '[]',
    source_path TEXT,
    art_path TEXT,
    status TEXT NOT NULL DEFAULT 'downloading',
    source TEXT DEFAULT 'soulseek',
    username TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS track_likes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, track_id)
  );

  CREATE TABLE IF NOT EXISTS artist_likes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, artist_id)
  );

  CREATE TABLE IF NOT EXISTS album_likes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, album_id)
  );

  CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, track_id)
  );

  CREATE TABLE IF NOT EXISTS downloads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id INTEGER REFERENCES tracks(id) ON DELETE SET NULL,
    username TEXT,
    filename TEXT NOT NULL,
    size INTEGER,
    provider TEXT NOT NULL DEFAULT 'soulseek',
    ref TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    added_at INTEGER NOT NULL,
    completed_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_tracks_status ON tracks(status);
  CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist_id);
  CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album_id);
  CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums(artist_id);
  CREATE INDEX IF NOT EXISTS idx_playlist_tracks_pos ON playlist_tracks(playlist_id, position);
`)

// migrate pre-existing databases created before the multi-source support
function ensureColumn(table, name, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!cols.some((c) => c.name === name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
  }
}
ensureColumn('downloads', 'provider', 'provider TEXT NOT NULL DEFAULT \'soulseek\'')
ensureColumn('downloads', 'ref', 'ref TEXT')
ensureColumn('downloads', 'sources', 'sources TEXT')

export const now = () => Date.now()

export function trackToJson(row) {
  if (!row) return null
  return {
    ...row,
    genres: safeJson(row.genres, []),
    liked: !!row.liked
  }
}

export function safeJson(str, fallback) {
  if (str == null) return fallback
  try {
    return JSON.parse(str)
  } catch {
    return fallback
  }
}

export function getTrackRow(trackId) {
  return db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId)
}
