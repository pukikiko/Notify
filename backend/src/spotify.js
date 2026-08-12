import { config } from './config.js'

const API = 'https://api.spotify.com/v1'
const TOKEN_URL = 'https://accounts.spotify.com/api/token'

let accessToken = null
let tokenExpiresAt = 0
let tokenPromise = null

export function spotifyConfigured() {
  return !!(config.spotify.clientId && config.spotify.clientSecret)
}

async function getToken() {
  if (accessToken && Date.now() < tokenExpiresAt) return accessToken
  if (tokenPromise) return tokenPromise
  tokenPromise = (async () => {
    const auth = Buffer.from(`${config.spotify.clientId}:${config.spotify.clientSecret}`).toString('base64')
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }).toString()
    })
    if (!res.ok) throw new Error(`Spotify auth failed: HTTP ${res.status}`)
    const data = await res.json()
    accessToken = data.access_token
    tokenExpiresAt = Date.now() + Math.max(0, (data.expires_in - 60)) * 1000
    return accessToken
  })()
  try {
    return await tokenPromise
  } finally {
    tokenPromise = null
  }
}

/** GET a Spotify API endpoint. Accepts a path (`/v1/...`) or a full URL. */
export async function spotifyFetch(url, retry = true) {
  if (url.startsWith('http')) {
    url = url.replace('https://api.spotify.com/v1', '')
  } else if (!url.startsWith('/')) {
    url = `/${url}`
  }
  const full = `${API}${url}`
  const token = await getToken()
  const res = await fetch(full, { headers: { Authorization: `Bearer ${token}` } })
  if (res.status === 401 && retry) {
    // token may have expired mid-flight — force a fresh one and retry once
    accessToken = null
    tokenExpiresAt = 0
    return spotifyFetch(url, false)
  }
  if (!res.ok) throw new Error(`Spotify HTTP ${res.status} for ${url}`)
  return res.json()
}

/* ------------------------------------------------------------------ */
/* entity shaping                                                      */
/* ------------------------------------------------------------------ */

export function pickImage(images) {
  if (!Array.isArray(images) || !images.length) return null
  const mid = images.find((i) => i.width >= 300 && i.width <= 700)
  return mid?.url || images[0].url
}

export function artistEntity(a) {
  return {
    kind: 'artist',
    id: `artist:${a.id}`,
    name: a.name,
    mbid: a.id,
    genres: a.genres || [],
    image: pickImage(a.images),
    popularity: a.popularity ?? null
  }
}

export function albumEntity(al, { trackCount } = {}) {
  const artist = al.artists?.[0] || null
  return {
    kind: 'album',
    id: `album:${al.id}`,
    title: al.name,
    artist: artist ? { name: artist.name, mbid: artist.id } : null,
    year: al.release_date ? Number(al.release_date.slice(0, 4)) || null : null,
    mbid: al.id,
    image: pickImage(al.images),
    trackCount: trackCount ?? al.total_tracks ?? null,
    albumType: al.album_type || null
  }
}

export function trackEntity(t) {
  const artist = t.artists?.[0] || null
  const album = t.album || null
  return {
    kind: 'track',
    id: `track:${t.id}`,
    title: t.name,
    artist: artist ? { name: artist.name, mbid: artist.id } : null,
    album: album ? { title: album.name, mbid: album.id, year: album.release_date ? Number(album.release_date.slice(0, 4)) || null : null, image: pickImage(album.images) } : null,
    mbid: t.id,
    duration: t.duration_ms ? Math.round(t.duration_ms / 1000) : null,
    image: album ? pickImage(album.images) : null,
    trackNo: t.track_number || null,
    popularity: t.popularity ?? null
  }
}

export function playlistEntity(p) {
  return {
    kind: 'playlist',
    id: p.id,
    mbid: p.id,
    name: p.name,
    owner: p.owner?.display_name || null,
    ownerId: p.owner?.id || null,
    description: p.description || null,
    trackCount: p.tracks?.total ?? null,
    followers: p.followers?.total ?? null,
    image: pickImage(p.images),
    public: p.public ?? null,
    spotifyUrl: p.external_urls?.spotify || null
  }
}

/** Raw album tracklist items shaped like the old MB tracklist rows. */
export function spTracklistRow(t) {
  return {
    title: t.name,
    position: t.track_number || null,
    length: t.duration_ms ? Math.round(t.duration_ms / 1000) : null,
    mbid: t.id,
    artist: t.artists?.[0]?.name || null
  }
}

/* ------------------------------------------------------------------ */
/* search                                                              */
/* ------------------------------------------------------------------ */

async function search(q, type, limit) {
  const params = new URLSearchParams({ q, type, limit: String(limit) })
  return spotifyFetch(`/search?${params}`)
}

export function spSearchArtists(q) {
  return search(q, 'artist', 12).then((d) => (d.artists?.items || []).filter(Boolean).map(artistEntity))
}

export function spSearchAlbums(q) {
  return search(q, 'album', 30).then((d) => (d.albums?.items || []).filter(Boolean).map(albumEntity))
}

export function spSearchTracks(q) {
  return search(q, 'track', 30).then((d) => (d.tracks?.items || []).filter(Boolean).map(trackEntity))
}

export function spSearchPlaylists(q) {
  return search(q, 'playlist', 20).then((d) => (d.playlists?.items || []).filter(Boolean).map(playlistEntity))
}

export function userEntity(u) {
  return {
    kind: 'user',
    id: u.id,
    mbid: u.id,
    name: u.display_name || u.id,
    image: pickImage(u.images),
    followers: u.followers?.total ?? null,
    spotifyUrl: u.external_urls?.spotify || null
  }
}

/* ------------------------------------------------------------------ */
/* artist                                                              */
/* ------------------------------------------------------------------ */

export function spArtistDetail(id) {
  return spotifyFetch(`/artists/${id}`)
}

export function spArtistTopTracks(id, limit = 20) {
  return spotifyFetch(`/artists/${id}/top-tracks?market=US`)
    .then((d) => (d.tracks || []).slice(0, limit).map(trackEntity))
}

export function spArtistRelated(id) {
  return spotifyFetch(`/artists/${id}/related-artists`)
    .then((d) => (d.artists || []).map(artistEntity))
}

export function spArtistAlbums(id, limit = 20) {
  const params = new URLSearchParams({ include_groups: 'album,single', limit: String(limit) })
  return spotifyFetch(`/artists/${id}/albums?${params}`)
    .then((d) => (d.items || []).map(albumEntity))
}

/* ------------------------------------------------------------------ */
/* album                                                               */
/* ------------------------------------------------------------------ */

export function spAlbumDetail(id) {
  return spotifyFetch(`/albums/${id}`)
}

export async function spAlbumTracks(id) {
  const items = []
  let url = `/albums/${id}/tracks?limit=50`
  while (url) {
    const data = await spotifyFetch(url)
    items.push(...(data.items || []))
    url = data.next || null
  }
  return items.map(spTracklistRow)
}

/* ------------------------------------------------------------------ */
/* playlist                                                            */
/* ------------------------------------------------------------------ */

export function spPlaylistDetail(id) {
  return spotifyFetch(`/playlists/${id}`)
}

/** Full tracklist of a Spotify playlist (paginated, unavailable items
    dropped). Shaped like raw Spotify track objects. */
export async function spPlaylistTracks(id) {
  const items = []
  let url = `/playlists/${id}/tracks?limit=50`
  while (url) {
    const data = await spotifyFetch(url)
    items.push(...(data.items || []).map((it) => it.track).filter(Boolean))
    url = data.next || null
  }
  return items
}

/* ------------------------------------------------------------------ */
/* user profile                                                        */
/* ------------------------------------------------------------------ */

/** Public playlists of a Spotify user (paginated). The /users/{id}
    profile endpoint itself is deprecated for client-credentials, so the
    profile page is built from search results + this playlist listing. */
export async function spUserPlaylists(id) {
  const items = []
  let url = `/users/${id}/playlists?limit=50`
  while (url) {
    const data = await spotifyFetch(url)
    items.push(...(data.items || []).map(playlistEntity))
    url = data.next || null
  }
  return items
}

/** Fetch a Spotify-hosted image URL as a buffer (for local cover caching). */export async function fetchSpotifyImage(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal })
    if (!res.ok) return null
    return Buffer.from(await res.arrayBuffer())
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
