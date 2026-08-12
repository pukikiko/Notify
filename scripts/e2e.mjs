import fs from 'node:fs'

const BASE = 'http://localhost:4000'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0

function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
  if (!cond) failures++
}

async function req(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { status: res.status, data, headers: res.headers }
}

const alice = (await req('/api/auth/login', { method: 'POST', body: { username: 'alice', password: 'secret123' } })).data
const bob = (await req('/api/auth/login', { method: 'POST', body: { username: 'bob', password: 'secret456' } })).data
const TA = alice.token
const TB = bob.token

check('alice login', !!alice.token)
check('bob login', !!bob.token)

// ---- alice's playlist ----
const pl = await req('/api/playlists', { token: TA })
check('alice has playlist "Roadtrip"', pl.data.playlists.some((p) => p.name === 'Roadtrip'), pl.data.playlists.map((p) => p.name).join(','))

// ---- bob downloads a new track into the shared pool ----
const search = await req('/api/soulseek/search?q=', { token: TB })
const user = search.data.results[5]
const file = user.files[0]
const dl = await req('/api/soulseek/download', { method: 'POST', token: TB, body: { username: user.username, filename: file.filename, size: file.size, duration: file.length, format: file.format } })
const trackId = dl.data.track?.id
check('bob queued download', dl.status === 202 && trackId, file.filename)

await sleep(7000)

// ---- bob likes it ----
await req(`/api/library/tracks/${trackId}/like`, { method: 'POST', token: TB })
const liked = await req('/api/library/liked/tracks', { token: TB })
check('bob liked the new track', liked.data.tracks.some((t) => t.id === trackId))

// ---- alice can see the same cached track (shared pool) ----
const lib = await req('/api/library/tracks', { token: TA })
const shared = lib.data.tracks.find((t) => t.id === trackId)
check('alice sees bob-downloaded track in shared pool', !!shared && shared.status === 'available', shared?.title)

// ---- both stream it, each in their own preferred format ----
await req('/api/auth/settings', { method: 'PUT', token: TB, body: { preferredFormat: 'opus-160' } })
const sA = await fetch(`${BASE}/api/stream/${trackId}`, { headers: { Authorization: `Bearer ${TA}`, Range: 'bytes=0-999' } })
const sB = await fetch(`${BASE}/api/stream/${trackId}`, { headers: { Authorization: `Bearer ${TB}`, Range: 'bytes=0-999' } })
check('alice streams (audio/mpeg)', sA.status === 206 && (sA.headers.get('content-type') || '').includes('audio/mpeg'), sA.status + ' ' + sA.headers.get('content-type'))
check('bob streams (audio/ogg opus)', sB.status === 206 && (sB.headers.get('content-type') || '').includes('audio/ogg'), sB.status + ' ' + sB.headers.get('content-type'))

// ---- radio ----
const r1 = await req(`/api/radio/seed?type=track&id=${trackId}&limit=10`, { token: TA })
check('track radio returns station', r1.data.tracks.length >= 3, r1.data.tracks.length + ' tracks')
const r2 = await req('/api/radio/seed?type=playlist&id=1&limit=10', { token: TA })
check('playlist radio works', r2.data.tracks.length > 0)
const r3 = await req('/api/radio/seed?type=album&id=3&limit=10', { token: TA })
check('album radio works', r3.data.tracks.length > 0)

// ---- settings ----
const set = await req('/api/auth/settings', { method: 'PUT', token: TA, body: { preferredFormat: 'mp3-192' } })
check('alice settings saved', set.data.settings.preferredFormat === 'mp3-192')

// ---- status ----
const st = await req('/api/status', { token: TA })
check('status reports cache', st.data.cache.availableTracks >= 13, st.data.cache.availableTracks + ' available, mode=' + st.data.soulseek.mode)

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`)
process.exit(failures === 0 ? 0 : 1)
