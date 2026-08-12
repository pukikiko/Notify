import React, { useEffect, useState, useRef } from 'react'
import { api } from '../api'
import { usePlayer } from '../player'
import { Card } from '../components/Cards'
import DiscoverTracks from '../components/DiscoverTracks'
import { PlayIcon, SearchIcon } from '../icons'

const BROWSE = [
  { title: 'Synthwave', color: '#27856a', q: 'synthwave' },
  { title: 'Indie Folk', color: '#8d67ab', q: 'indie folk' },
  { title: 'Electronic', color: '#ba5d07', q: 'electronic' },
  { title: 'Latin Pop', color: '#e13300', q: 'latin' },
  { title: 'Blues Rock', color: '#7358ff', q: 'blues rock' },
  { title: 'Ambient', color: '#608108', q: 'ambient' },
  { title: 'Alternative', color: '#1e3264', q: 'alternative' },
  { title: 'Chamber Pop', color: '#0d73ec', q: 'chamber pop' },
  { title: 'Punk', color: '#e8115b', q: 'punk' },
  { title: 'Americana', color: '#148a08', q: 'americana' },
  { title: 'House', color: '#503750', q: 'house' },
  { title: 'Indie Rock', color: '#bc5900', q: 'indie rock' },
  { title: 'Dream Pop', color: '#503750', q: 'dream pop' },
  { title: 'Post-Rock', color: '#e91429', q: 'post-rock' },
  { title: 'Shoegaze', color: '#477d95', q: 'shoegaze' },
  { title: 'Soul', color: '#dc148c', q: 'soul' }
]

function fmtTime(s) {
  if (!s || isNaN(s)) return ''
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60).toString().padStart(2, '0')
  return `${m}:${sec}`
}

function Sk({ w, h, br, style }) {
  return <div className="sk" style={{ width: w, height: h, borderRadius: br || 4, ...style }} />
}

function SearchSkeleton() {
  return (
    <div className="search-skeleton">
      <div className="skeleton-top">
        <div className="sk-card sk-topcard">
          <Sk w={92} h={92} br={6} />
          <div className="sk-lines">
            <Sk w={64} h={12} />
            <Sk w={220} h={26} />
            <Sk w={140} h={12} />
          </div>
        </div>
        <div className="sk-popular">
          <Sk w={120} h={20} />
          {[0, 1, 2, 3].map((i) => (
            <div className="sk-row" key={i}>
              <Sk w={40} h={40} br={6} />
              <div className="sk-lines grow">
                <Sk w="80%" h={12} />
                <Sk w="55%" h={12} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <Sk w={140} h={20} className="skeleton-section-title" />
      <div className="skeleton-grid">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div className="sk-card" key={i}>
            <div className="sk" style={{ width: '100%', aspectRatio: '1', borderRadius: 6 }} />
            <Sk w="70%" h={14} />
            <Sk w="48%" h={12} />
          </div>
        ))}
      </div>

      <Sk w={140} h={20} className="skeleton-section-title" />
      <div className="skeleton-grid">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div className="sk-card" key={i}>
            <div className="sk" style={{ width: '100%', aspectRatio: '1', borderRadius: 6 }} />
            <Sk w="70%" h={14} />
            <Sk w="48%" h={12} />
          </div>
        ))}
      </div>

      <Sk w={140} h={20} className="skeleton-section-title" />
      <div className="skeleton-songs">
        {[0, 1, 2, 3].map((i) => (
          <div className="sk-row" key={i}>
            <Sk w={40} h={40} br={6} />
            <div className="sk-lines grow">
              <Sk w="35%" h={13} />
              <Sk w="22%" h={12} />
            </div>
            <Sk w={44} h={12} />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function SearchView({ navigate }) {
  const { playQueue, current } = usePlayer()
  const [q, setQ] = useState('')
  const [lib, setLib] = useState(null)
  const [disc, setDisc] = useState(null)
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const seqRef = useRef(0)
  const timeoutRef = useRef(null)

  // read the query from the topbar (hash ?q=)
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
    setQ(params.get('q') || '')
  }, [])

  useEffect(() => {
    const onHash = () => {
      const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
      setQ(params.get('q') || '')
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    const seq = ++seqRef.current
    clearTimeout(timeoutRef.current)
    setError(null)

    if (!q.trim()) {
      setLib(null)
      setDisc(null)
      setSearching(false)
      return
    }

    timeoutRef.current = setTimeout(async () => {
      setSearching(true)
      // Library and discover results are fetched independently: a slow
      // Spotify query must never block cached library results.
      const fetchLib = (async () => {
        try {
          const res = await api(`/library/search?q=${encodeURIComponent(q)}`)
          if (seq === seqRef.current) setLib(res)
        } catch (err) {
          if (seq === seqRef.current) setError(err.message)
        }
      })()
      const fetchDisc = (async () => {
        try {
          const res = await api(`/discover/search?q=${encodeURIComponent(q)}`)
          if (seq === seqRef.current) setDisc(res)
        } catch (err) {
          if (seq === seqRef.current) setError(err.message)
        }
      })()
      await Promise.allSettled([fetchLib, fetchDisc])
      if (seq === seqRef.current) setSearching(false)
    }, 300)

    return () => { clearTimeout(timeoutRef.current) }
  }, [q])

  const playNow = async (payload) => {
    if (busy) return
    setBusy(true)
    try {
      const { tracks } = await api('/discover/play', { method: 'POST', body: payload })
      if (!tracks.length) throw new Error('Nothing playable found')
      playQueue(tracks, 0)
    } catch (err) {
      setError(err.message)
      setTimeout(() => setError(null), 3000)
    } finally {
      setBusy(false)
    }
  }

  const playTrack = (t, idx) => {
    const i = typeof idx === 'number' ? idx : tracks.findIndex((x) => x.id === t.id || (x.mbid && t.mbid && x.mbid === t.mbid))
    playQueue(tracks, i < 0 ? 0 : i)
  }

  const playAlbum = (a) => playNow({
    kind: 'album',
    artist: a.artist?.name,
    album: a.title,
    releaseMbid: a.mbid,
    image: a.image,
    source: a.source
  })

  const playArtist = (a) => playNow({ kind: 'artist', artist: a.name, image: a.image })

  const artists = disc?.artists || []
  const albums = disc?.albums || []
  const playlists = disc?.playlists || []
  const tracks = disc?.popularTracks?.length ? disc.popularTracks : (disc?.tracks || [])
  const libTracks = lib?.tracks || []

  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  const strongAlbum = albums.find((a) => norm(a.title) === norm(q))
  const topResult = disc?.artist || strongAlbum || tracks[0] || artists[0] || albums[0] || null
  const topType = topResult ? (topResult.kind || 'track') : null
  const topLabel = topType === 'artist' ? 'Artist' : topType === 'album' ? 'Album' : 'Song'

  const artistHref = (a) => a.href || (a.mbid ? `/artist/sp-${a.mbid}` : null)
  const albumHref = (a) => a.href || (a.mbid ? `/album/sp-${a.mbid}` : null)

  const openArtist = (a) => { const h = artistHref(a); if (h) navigate(h); else playArtist(a) }
  const openAlbum = (a) => { const h = albumHref(a); if (h) navigate(h); else playAlbum(a) }

  const topClick = () => {
    if (!topResult) return
    if (topType === 'artist') openArtist(topResult)
    else if (topType === 'album') openAlbum(topResult)
    else playTrack(topResult)
  }

  const noResults = q.trim() && !searching && disc && !artists.length && !albums.length && !playlists.length && !tracks.length && !libTracks.length

  const hasResults = Boolean((disc || lib) && (artists.length || albums.length || playlists.length || tracks.length || libTracks.length))

  return (
    <div className="search-page">
      <div style={{ position: 'relative', zIndex: 1 }}>
        {!q.trim() && (
          <>
            <h1 className="page-title" style={{ marginTop: 16 }}>Browse all</h1>
            <div className="browse-grid">
              {BROWSE.map((b) => (
                <div key={b.title} className="browse-card" style={{ background: b.color }} onClick={() => navigate(`/search?q=${encodeURIComponent(b.q)}`)}>
                  {b.title}
                  <div className="browse-art" style={{ background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                    <SearchIcon size={28} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {q.trim() && searching && !hasResults && <SearchSkeleton />}
        {busy && <div className="spinner" />}
        {error && <div className="error" style={{ textAlign: 'center', padding: 40 }}>{error}</div>}

        {noResults && (
          <div className="empty">No results found for “{q}” on Spotify, YouTube Music or SoundCloud. Try a different spelling.</div>
        )}

        {hasResults && (
          <>
            {topResult && (
              <div className="top-result-layout">
                <div className="top-result-card" onClick={topClick}>
                  <div className="tr-art">
                    {topResult.image
                      ? <img src={topResult.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4 }} />
                      : <SearchIcon size={28} />}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="tr-label">{topLabel}</div>
                    <div className="tr-name">{topResult.name || topResult.title}</div>
                    <div className="tr-sub">
                      {topType === 'artist'
                        ? (topResult.genres?.slice(0, 2).join(' · ') || 'Artist')
                        : topType === 'album'
                          ? (topResult.artist?.name || 'Album')
                          : (topResult.artist?.name || '')}
                    </div>
                  </div>
                </div>

                <div>
                  <h2 className="section-title" style={{ margin: '0 0 12px' }}>Popular</h2>
                  {tracks.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {tracks.slice(0, 4).map((t) => (
                        <div key={t.id || t.mbid} className="sp-tracklist" style={{ border: 0 }}>
                          <div className="tr-title-cell" style={{ padding: '8px 48px 8px 0', cursor: 'pointer' }} onClick={() => playTrack(t)}>
                            <span className="track-art" style={{ width: 40, height: 40 }}>
                              {t.image ? <img src={t.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
                            </span>
                            <span className="tt">
                              <div className="tr-title">{t.title}</div>
                              <div className="tr-cell-link">{t.artist?.name}</div>
                            </span>
                            <span className="tr-duration" style={{ marginLeft: 'auto' }}>{fmtTime(t.duration)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : libTracks.length > 0 ? (
                    <div className="tr-title-cell" style={{ padding: '8px 0', cursor: 'pointer' }} onClick={() => playQueue(libTracks, 0)}>
                      <span className="tt">
                        <div className="tr-title">{libTracks[0].title}</div>
                        <div className="tr-cell-link">{libTracks[0].artist?.name}</div>
                      </span>
                    </div>
                  ) : (
                    <div className="text-sub">No songs found</div>
                  )}
                </div>
              </div>
            )}

            {artists.length > 0 && (
              <>
                <h2 className="section-title">Artists</h2>
                <div className="grid">
                  {artists.map((a) => (
                    <Card
                      key={a.id}
                      art={a.image}
                      name={a.name}
                      meta={a.genres?.slice(0, 2).join(' · ') || 'Artist'}
                      rounded
                      onClick={() => openArtist(a)}
                      onPlay={() => playArtist(a)}
                      playBtn={<PlayIcon />}
                    />
                  ))}
                </div>
              </>
            )}

            {disc?.degraded && !searching && (
              <div className="text-sub" style={{ padding: '0 0 16px' }}>Not on Spotify — showing matches from YouTube Music and SoundCloud instead.</div>
            )}

            {albums.length > 0 && (
              <>
                <h2 className="section-title">Albums</h2>
                <div className="grid">
                  {albums.map((a) => (
                    <Card
                      key={a.id}
                      art={a.image}
                      name={a.title}
                      meta={`${a.artist?.name || ''} · ${a.year || ''}`}
                      onClick={() => openAlbum(a)}
                      onPlay={() => playAlbum(a)}
                      playBtn={<PlayIcon />}
                    />
                  ))}
                </div>
              </>
            )}

            {playlists.length > 0 && (
              <>
                <h2 className="section-title">Playlists</h2>
                <div className="grid">
                  {playlists.map((p) => (
                    <Card
                      key={p.id}
                      art={p.image}
                      name={p.name}
                      meta={`${p.owner || 'Spotify'} · ${p.trackCount || 0} songs`}
                      onClick={() => navigate(`/playlist/sp-${p.id}`)}
                      playBtn={<PlayIcon />}
                    />
                  ))}
                </div>
              </>
            )}

            {tracks.length > 0 && (
              <>
                <h2 className="section-title">Songs</h2>
                <DiscoverTracks tracks={tracks} onPlay={playTrack} current={current} showAlbum />
              </>
            )}

            {libTracks.length > 0 && (
              <>
                <h2 className="section-title">In your library</h2>
                <DiscoverTracks tracks={libTracks} onPlay={(t, idx) => playQueue(libTracks, idx)} current={current} showAlbum />
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
