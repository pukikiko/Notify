import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { usePlayer } from '../player'
import TrackList from '../components/TrackList'
import { Card, AlbumCard } from '../components/Cards'
import Artwork from '../components/Artwork'
import { PlayIcon, PauseIcon, HeartIcon, HeartFilledIcon, DotsIcon, RadioIcon } from '../icons'

function hashHue(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360
  return h
}

export default function ArtistView({ id, navigate }) {
  const { playQueue, current, playing, toggle } = usePlayer()
  const [data, setData] = useState(null)
  const [liked, setLiked] = useState(false)
  const [toast, setToast] = useState(null)
  const [busy, setBusy] = useState(false)

  const isDiscover = !/^\d+$/.test(id || '')
  let decoded = null
  try { decoded = decodeURIComponent(id || '') } catch { decoded = id || '' }
  const mbid = decoded.startsWith('sp-') ? decoded.slice(3) : null
  const catKey = decoded.startsWith('catalog:') ? decoded : null
  const discoverKey = mbid || catKey

  useEffect(() => {
    if (isDiscover) {
      api(`/discover/artist/${encodeURIComponent(discoverKey)}`).then((d) => setData(d)).catch(() => setData({ error: true }))
    } else {
      api(`/library/artists/${id}`).then((d) => { setData(d); setLiked(!!d.artist?.liked) }).catch(() => setData({ error: true }))
    }
  }, [id, isDiscover, discoverKey])

  if (!data) return <div className="page"><div className="spinner" /></div>
  if (data.error) return <div className="page"><div className="empty">Artist not found</div></div>

  const artist = isDiscover ? data.artist : data.artist
  const tracks = data.popularTracks || data.tracks || []
  const albums = data.albums || []

  const hue = hashHue(artist.name)

  const isCurrentTrack = (t) => current && (current.id === t.id || (t.mbid && current.mbid && t.mbid === current.mbid))
  const isPlayingArtist = tracks.some(isCurrentTrack)

  const playAll = () => {
    if (isPlayingArtist) toggle()
    else playQueue(tracks, 0)
  }

  const playAlbumDiscover = async (a) => {
    if (busy) return
    setBusy(true)
    try {
      const { tracks: rows } = await api('/discover/play', {
        method: 'POST',
        body: {
          kind: 'album',
          artist: a.artist?.name,
          album: a.title,
          releaseMbid: a.mbid,
          image: a.image,
          source: a.source
        }
      })
      if (rows.length) playQueue(rows, 0)
    } catch (err) {
      setToast(err.message)
      setTimeout(() => setToast(null), 2500)
    } finally {
      setBusy(false)
    }
  }

  const radio = async () => {
    if (isDiscover) {
      setToast('Artist radio works once some tracks are in your library')
      setTimeout(() => setToast(null), 2500)
      return
    }
    const { tracks: station } = await api(`/radio/seed?type=artist&id=${artist.id}&limit=50`)
    if (station.length) playQueue(station, 0, { radioSeed: { type: 'artist', id: artist.id } })
  }

  const like = async () => {
    if (isDiscover) {
      setToast('Save it by playing something first')
      setTimeout(() => setToast(null), 2500)
      return
    }
    const res = await api(`/library/artists/${artist.id}/like`, { method: 'POST' })
    setLiked(res.liked)
    setToast(res.liked ? 'Added to Liked Artists' : 'Removed from Liked Artists')
    setTimeout(() => setToast(null), 1800)
  }

  return (
    <div className="page page-with-hero">
      <div className="page-hero-bg" style={{ background: `linear-gradient(180deg, hsl(${hue} 45% 18%) 0%, hsl(${hue} 30% 12%) 45%, var(--sp-bg-base) 100%)`, height: 380 }} />
      <div className="hero">
        <Artwork src={artist.image} alt={artist.name} className="hero-art rounded" rounded />
        <div className="hero-info">
          <div className="hero-label">Artist</div>
          <h1 className="hero-title">{artist.name}</h1>
          <div className="hero-meta">
            {artist.trackCount ? <>{artist.trackCount} songs</> : ''}
            {artist.albumCount ? <><span className="sep">·</span> {artist.albumCount} albums</> : ''}
            {artist.genres?.length ? <><span className="sep">·</span> {artist.genres.slice(0, 3).join(', ')}</> : ''}
            {isDiscover && <span className="text-sub">Spotify</span>}
          </div>
        </div>
      </div>

      <div className="action-row">
        <button className="sp-btn--primary sp-btn" onClick={playAll} title={isPlayingArtist && playing ? 'Pause' : 'Play'}>
          {isPlayingArtist && playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button className={`sp-icon-btn ${liked ? 'heart-on' : ''}`} style={{ width: 40, height: 40 }} title="Follow artist" onClick={like}>
          {liked ? <HeartFilledIcon size={28} /> : <HeartIcon size={28} />}
        </button>
        <button className="sp-icon-btn" style={{ width: 40, height: 40 }} title="Artist radio" onClick={radio}><RadioIcon size={24} /></button>
        <button className="sp-icon-btn" style={{ width: 40, height: 40 }} title="More"><DotsIcon size={24} /></button>
      </div>

      {tracks.length > 0 && (
        <div style={{ padding: '0 32px' }}>
          <h2 className="section-title" style={{ marginTop: 0 }}>Popular</h2>
          <TrackList tracks={tracks.slice(0, 10)} current={current} showAlbum={false} />
        </div>
      )}

      {albums.length > 0 && (
        <div style={{ padding: '0 32px' }}>
          <h2 className="section-title">Discography</h2>
          <div className="grid">
            {albums.map((a) => {
              const href = a.href || (a.mbid ? `/album/sp-${a.mbid}` : null)
              if (!href) {
                return (
                  <Card
                    key={a.id}
                    art={a.image}
                    name={a.title}
                    meta={`${a.artist?.name || ''} · ${a.year || ''} · Album`}
                    onClick={() => playAlbumDiscover(a)}
                    onPlay={() => playAlbumDiscover(a)}
                    playBtn={<PlayIcon />}
                  />
                )
              }
              return <AlbumCard key={a.id} album={{ ...a, id: href.split('/').pop() }} />
            })}
          </div>
        </div>
      )}

      {!isDiscover && artist.similar?.length > 0 && (
        <div style={{ padding: '0 32px' }}>
          <h2 className="section-title">Fans also like</h2>
          <div className="chip-row">
            {artist.similar.map((name) => (
              <button key={name} className="genre-tag" onClick={() => { window.location.hash = `/search?q=${encodeURIComponent(name)}` }}>{name}</button>
            ))}
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
