import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { usePlayer } from '../player'
import TrackList from '../components/TrackList'
import Artwork from '../components/Artwork'
import { PlayIcon, PauseIcon, HeartIcon, HeartFilledIcon, DotsIcon } from '../icons'

function hashHue(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360
  return h
}

export default function AlbumView({ id, navigate }) {
  const { playQueue, current, playing, toggle } = usePlayer()
  const [data, setData] = useState(null)
  const [liked, setLiked] = useState(false)
  const [toast, setToast] = useState(null)

  const isDiscover = !/^\d+$/.test(id || '')
  let decoded = null
  try { decoded = decodeURIComponent(id || '') } catch { decoded = id || '' }
  const mbid = decoded.startsWith('sp-') ? decoded.slice(3) : null
  const catKey = decoded.startsWith('catalog:') ? decoded : null
  const discoverKey = mbid || catKey

  useEffect(() => {
    if (isDiscover) {
      api(`/discover/album/${encodeURIComponent(discoverKey)}`).then((d) => setData(d)).catch(() => setData({ error: true }))
    } else {
      api(`/library/albums/${id}`).then((d) => { setData(d); setLiked(!!d.album?.liked) }).catch(() => setData({ error: true }))
    }
  }, [id, isDiscover, discoverKey])

  if (!data) return <div className="page"><div className="spinner" /></div>
  if (data.error) return <div className="page"><div className="empty">Album not found</div></div>

  const album = data.album
  const tracks = data.tracks || []

  const hue = hashHue(album.title + (album.artist?.name || ''))

  const isCurrentTrack = (t) => current && (current.id === t.id || (t.mbid && current.mbid && t.mbid === current.mbid))
  const isPlayingAlbum = tracks.some(isCurrentTrack)

  const playAll = () => {
    if (isPlayingAlbum) toggle()
    else playQueue(tracks, 0)
  }

  const like = async () => {
    if (isDiscover) {
      setToast('Save it by playing something first')
      setTimeout(() => setToast(null), 2500)
      return
    }
    const res = await api(`/library/albums/${album.id}/like`, { method: 'POST' })
    setLiked(res.liked)
    setToast(res.liked ? 'Added to Liked Albums' : 'Removed from Liked Albums')
    setTimeout(() => setToast(null), 1800)
  }

  const totalMin = Math.round(tracks.reduce((n, t) => n + (t.duration || 0), 0) / 60)

  return (
    <div className="page page-with-hero">
      <div className="page-hero-bg" style={{ background: `linear-gradient(180deg, hsl(${hue} 45% 22%) 0%, hsl(${hue} 30% 14%) 45%, var(--sp-bg-base) 100%)`, height: 380 }} />
      <div className="hero">
        <Artwork src={album.image} alt={album.title} className="hero-art" />
        <div className="hero-info">
          <div className="hero-label">Album</div>
          <h1 className="hero-title">{album.title}</h1>
          <div className="hero-meta">
            {isDiscover && album.artist?.href
              ? <a href={`#${album.artist.href}`} style={{ color: 'var(--sp-text)' }}>{album.artist?.name}</a>
              : album.artist?.id
                ? <a href={`#/artist/${album.artist.id}`} style={{ color: 'var(--sp-text)' }}>{album.artist?.name}</a>
                : album.artist?.name}
            {album.year && <><span className="sep">·</span> <span>{album.year}</span></>}
            {tracks.length > 0 && (
              <>
                <span className="sep">·</span>
                <span>{tracks.length} songs{totalMin > 0 ? `, ${totalMin} min` : ''}</span>
              </>
            )}
            {isDiscover && <><span className="sep">·</span> <span className="text-sub">Spotify</span></>}
          </div>
        </div>
      </div>

      <div className="action-row">
        <button className="sp-btn--primary sp-btn" onClick={playAll} title={isPlayingAlbum && playing ? 'Pause' : 'Play'}>
          {isPlayingAlbum && playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button className={`sp-icon-btn ${liked ? 'heart-on' : ''}`} style={{ width: 40, height: 40 }} title="Save to your library" onClick={like}>
          {liked ? <HeartFilledIcon size={28} /> : <HeartIcon size={28} />}
        </button>
        <button className="sp-icon-btn" style={{ width: 40, height: 40 }} title="More"><DotsIcon size={24} /></button>
      </div>

      <div style={{ padding: '0 32px' }}>
        <TrackList tracks={tracks} current={current} showAlbum={false} showArtist={false} />
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
