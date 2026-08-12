import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { usePlayer } from '../player'
import TrackList from '../components/TrackList'
import Artwork from '../components/Artwork'
import { PlayIcon, PauseIcon, PlusIcon, DotsIcon } from '../icons'

function hashHue(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360
  return h
}

function trackPayload(t) {
  return {
    kind: 'track',
    artist: t.artist?.name,
    album: t.album?.title,
    title: t.title,
    mbid: t.mbid,
    image: t.image,
    duration: t.duration,
    source: t.source
  }
}

export default function SpotifyPlaylistView({ id, navigate }) {
  const { playQueue, current, playing, toggle } = usePlayer()
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)

  const decoded = (() => { try { return decodeURIComponent(id || '') } catch { return id || '' } })()
  const spotifyId = decoded.startsWith('sp-') ? decoded.slice(3) : decoded

  useEffect(() => {
    api(`/discover/playlist/${encodeURIComponent(spotifyId)}`)
      .then(setData)
      .catch(() => setData({ error: true }))
  }, [spotifyId])

  if (!data) return <div className="page"><div className="spinner" /></div>
  if (data.error || !data.playlist) return <div className="page"><div className="empty">Playlist not found</div></div>

  const { playlist, tracks } = data
  const hue = hashHue(playlist.name)

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500) }

  const isCurrentTrack = (t) => current && (current.id === t.id || (t.mbid && current.mbid && t.mbid === current.mbid))
  const isPlayingPlaylist = tracks.some(isCurrentTrack)

  const playAll = () => {
    if (isPlayingPlaylist) toggle()
    else playQueue(tracks, 0)
  }

  const importToLibrary = async () => {
    if (busy) return
    setBusy(true)
    try {
      const { tracks: rows } = await api('/discover/play-many', { method: 'POST', body: { items: tracks.map(trackPayload) } })
      if (!rows.length) throw new Error('Nothing playable found')
      const { playlist: pl } = await api('/playlists', { method: 'POST', body: { name: playlist.name, description: `Imported from Spotify${playlist.owner ? ` by ${playlist.owner}` : ''}` } })
      await api(`/playlists/${pl.id}/tracks`, { method: 'POST', body: { trackIds: rows.map((t) => t.id) } })
      navigate(`/playlist/${pl.id}`)
    } catch (err) { flash(err.message) } finally { setBusy(false) }
  }

  return (
    <div className="page page-with-hero">
      <div className="page-hero-bg" style={{ background: `linear-gradient(180deg, hsl(${hue} 45% 20%) 0%, hsl(${hue} 30% 12%) 45%, var(--sp-bg-base) 100%)`, height: 380 }} />
      <div className="hero">
        <Artwork src={playlist.image} alt={playlist.name} className="hero-art" />
        <div className="hero-info">
          <div className="hero-label">Public Playlist</div>
          <h1 className="hero-title">{playlist.name}</h1>
          <div className="hero-meta">
            {playlist.ownerId ? (
              <button className="link-chip" onClick={() => navigate(`/profile/sp-${playlist.ownerId}`)}>{playlist.owner || 'Spotify'}</button>
            ) : (
              <span>{playlist.owner || 'Spotify'}</span>
            )}
            <span className="sep">·</span>
            <span>{tracks.length} songs</span>
            {playlist.description && <><span className="sep">·</span> <span className="text-sub">{playlist.description}</span></>}
          </div>
        </div>
      </div>

      <div className="action-row">
        <button className="sp-btn--primary sp-btn" onClick={playAll} title={isPlayingPlaylist && playing ? 'Pause' : 'Play'}>
          {isPlayingPlaylist && playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button className="sp-btn sp-btn--ghost" onClick={importToLibrary}><PlusIcon size={16} /> Save to your library</button>
        {playlist.spotifyUrl && (
          <a className="sp-btn sp-btn--outline" href={playlist.spotifyUrl} target="_blank" rel="noreferrer">
            Open in Spotify
          </a>
        )}
        <button className="sp-icon-btn" style={{ width: 40, height: 40 }} title="More"><DotsIcon size={24} /></button>
      </div>

      {busy && <div className="spinner" />}

      {tracks.length === 0 ? (
        <div className="empty" style={{ padding: '40px 32px' }}>This playlist has no playable tracks.</div>
      ) : (
        <div style={{ padding: '0 32px' }}>
          <TrackList tracks={tracks} current={current} showAlbum />
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
