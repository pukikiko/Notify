import { db, safeJson } from './db.js'

function genres(row) {
  return new Set(safeJson(row?.genres, []).map((g) => g.toLowerCase()))
}

function artistById(id) {
  return db.prepare('SELECT * FROM artists WHERE id = ?').get(id)
}

function availableTracks() {
  return db.prepare("SELECT * FROM tracks WHERE status = 'available'").all()
}

/** Deterministic-ish shuffle so consecutive calls produce variety. */
function shuffle(arr, seedOffset = 0) {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor((i * 2654435761 + seedOffset * 40503) % (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function scoreCandidate(candidate, { seedTrack, seedArtist, seedGenres, similarArtists }) {
  let score = 0
  if (seedTrack && candidate.id === seedTrack.id) return 0
  if (seedTrack) {
    if (candidate.artist_id === seedTrack.artist_id) score += 100
    if (seedTrack.album_id && candidate.album_id === seedTrack.album_id) score += 60
  }
  if (seedArtist && candidate.artist_id === seedArtist.id) score += 90

  const candGenres = genres(candidate)
  for (const g of seedGenres) {
    if (candGenres.has(g)) score += 25
  }

  if (similarArtists && candidate.artist_id) {
    const ar = artistById(candidate.artist_id)
    if (ar && similarArtists.includes(ar.name)) score += 45
  }
  // slight bias toward tracks from the same album for cohesion
  if (seedTrack?.album_id && candidate.album_id === seedTrack.album_id) score += 10
  return score
}

function pick(seedTrackId, seedArtistId, limit) {
  const pool = availableTracks()
  const seedTrack = seedTrackId ? pool.find((t) => t.id === seedTrackId) : null
  const seedArtist = seedArtistId ? artistById(seedArtistId) : null

  let seedGenres = new Set()
  if (seedTrack) seedGenres = genres(seedTrack)
  if (seedArtist && seedGenres.size === 0) seedGenres = genres(seedArtist)

  const similarArtists = seedArtist ? safeJson(seedArtist.similar, []) : []

  const scored = pool.map((c) => ({ t: c, s: scoreCandidate(c, { seedTrack, seedArtist, seedGenres, similarArtists }) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)

  const result = []
  if (seedTrack && seedTrack.status === 'available') result.push(seedTrack.id)
  if (seedArtist) {
    const sameArtist = scored.filter((x) => x.t.artist_id === seedArtist.id)
    for (const x of sameArtist) if (!result.includes(x.t.id)) result.push(x.t.id)
    if (result.length >= limit) return result.slice(0, limit)
  }
  // top tier: strong matches, then a shuffled fringe for variety
  const strong = scored.filter((x) => x.s >= 25 && !result.includes(x.t.id))
  for (const x of shuffle(strong, seedTrackId || 0)) {
    if (result.length >= limit) break
    result.push(x.t.id)
  }
  const weak = scored.filter((x) => x.s > 0 && x.s < 25 && !result.includes(x.t.id))
  for (const x of shuffle(weak, (seedTrackId || 0) + 1)) {
    if (result.length >= limit) break
    result.push(x.t.id)
  }
  // top up with recent tracks so short libraries still produce a full station
  if (result.length < limit) {
    const recent = db.prepare("SELECT id FROM tracks WHERE status = 'available' ORDER BY id DESC").all()
    for (const r of recent) {
      if (result.length >= limit) break
      if (!result.includes(r.id)) result.push(r.id)
    }
  }
  return result.slice(0, limit)
}

export function buildRadio({ type, id, limit = 50 }) {
  if (type === 'track') return pick(Number(id), null, limit)
  if (type === 'artist') return pick(null, Number(id), limit)
  if (type === 'album') {
    const seed = db.prepare("SELECT * FROM tracks WHERE album_id = ? AND status = 'available' ORDER BY disc_no, track_no LIMIT 1").get(Number(id))
    const result = pick(seed?.id ?? null, null, limit)
    const albumTrackIds = db.prepare("SELECT id FROM tracks WHERE album_id = ? AND status = 'available'").all(Number(id)).map((r) => r.id)
    return [...new Set([...albumTrackIds, ...result])].slice(0, limit)
  }
  if (type === 'playlist') {
    const rows = db.prepare(`
      SELECT pt.track_id FROM playlist_tracks pt
      WHERE pt.playlist_id = ?
      ORDER BY pt.position
    `).all(Number(id))
    const ids = rows.map((r) => r.track_id)
    if (!ids.length) return []
    const seedTrackId = ids[0]
    const seen = new Set(ids)
    const radio = pick(seedTrackId, null, limit)
    const result = []
    for (const t of [...ids, ...radio]) {
      if (!seen.has(t)) continue
      result.push(t)
      seen.delete(t)
      if (result.length >= limit) break
    }
    return result
  }
  return []
}
