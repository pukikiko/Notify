import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { usePlayer } from '../player'
import TrackTable from '../components/TrackTable'
import Artwork from '../components/Artwork'
import { PlayIcon, PauseIcon, PlusIcon, DotsIcon, RadioIcon } from '../icons'

function hashHue(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360
  return h
}

export default function PlaylistView({ id, navigate }) {
  const { playQueue, current, playing, toggle } = usePlayer()
  const [data, setData] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [toast, setToast] = useState(null)
  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState('')

  const load = () => api(`/playlists/${id}`).then(setData)
  useEffect(() => { load() }, [id])
  useEffect(() => { if (data) setName(data.playlist.name) }, [data?.playlist?.name])

  if (!data) return <div className="page"><div className="spinner" /></div>
  if (!data.playlist) return <div className="page"><div className="empty">Playlist not found</div></div>
  const { playlist, tracks } = data
  const existingIds = new Set(tracks.map((t) => t.id))
  const hue = hashHue(playlist.name)

  const playAll = () => {
    if (current && tracks.some((t) => t.id === current.id)) toggle()
    else playQueue(tracks, 0)
  }

  const radio = async () => {
    const { tracks: station } = await api(`/radio/seed?type=playlist&id=${playlist.id}&limit=60`)
    if (station.length) playQueue(station, 0, { radioSeed: { type: 'playlist', id: playlist.id } })
  }

  const searchLib = async (val) => {
    setQuery(val)
    if (!val.trim()) { setResults(null); return }
    const r = await api(`/library/search?q=${encodeURIComponent(val)}`)
    setResults(r)
  }

  const add = async (track) => {
    await api(`/playlists/${playlist.id}/tracks`, { method: 'POST', body: { trackIds: [track.id] } })
    setToast(`Added "${track.title}"`)
    setTimeout(() => setToast(null), 1800)
    load()
  }

  const remove = async (trackId) => {
    await api(`/playlists/${playlist.id}/tracks/${trackId}`, { method: 'DELETE' })
    load()
  }

  const del = async () => {
    await api(`/playlists/${playlist.id}`, { method: 'DELETE' })
    navigate('/playlists')
  }

  const rename = async () => {
    await api(`/playlists/${playlist.id}`, { method: 'PATCH', body: { name } })
    setEditingName(false)
    load()
  }

  const isPlaying = current && tracks.some((t) => t.id === current.id)
  const cover = tracks.find((t) => t.artUrl)?.artUrl || null

  return (
    <div className="page page-with-hero">
      <div className="page-hero-bg" style={{ background: `linear-gradient(180deg, hsl(${hue} 45% 22%) 0%, hsl(${hue} 30% 13%) 45%, var(--sp-bg-base) 100%)`, height: 380 }} />
      <div className="hero">
        <Artwork src={cover} alt={playlist.name} className="hero-art" />
        <div className="hero-info">
          <div className="hero-label">Playlist</div>
          {editingName ? (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
              <input value={name} onChange={(e) => setName(e.target.value)} style={{ fontSize: 28, fontWeight: 800, borderBottom: '1px solid #fff', padding: '0 4px' }} />
              <button className="sp-btn sp-btn--white" onClick={rename}>Save</button>
            </div>
          ) : (
            <h1 className="hero-title" onClick={() => setEditingName(true)} style={{ cursor: 'pointer' }}>{playlist.name}</h1>
          )}
          <div className="hero-meta">
            <span>{playlist.user_id ? 'You' : 'Notify'}</span>
            <span className="sep">·</span>
            <span>{tracks.length} songs, {Math.round((playlist.duration || 0) / 60)} min</span>
            {playlist.description && <><span className="sep">·</span> <span>{playlist.description}</span></>}
          </div>
        </div>
      </div>

      <div className="action-row">
        <button className="sp-btn--primary sp-btn" onClick={playAll} title={isPlaying && playing ? 'Pause' : 'Play'}>
          {isPlaying && playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button className="sp-icon-btn" style={{ width: 40, height: 40 }} title="Playlist radio" onClick={radio}><RadioIcon size={24} /></button>
        <button className="sp-btn sp-btn--ghost" onClick={() => setShowAdd(!showAdd)}><PlusIcon size={16} /> Add tracks</button>
        <button className="sp-btn sp-btn--outline" onClick={del}>Delete</button>
        <button className="sp-icon-btn" style={{ width: 40, height: 40 }} title="More"><DotsIcon size={24} /></button>
      </div>

      {showAdd && (
        <div style={{ padding: '0 32px 20px' }}>
          <div className="topbar-search" style={{ background: '#fff', maxWidth: 320, height: 40 }}>
            <input
              placeholder="Add songs from your library…"
              value={query}
              onChange={(e) => searchLib(e.target.value)}
              style={{ color: '#000' }}
              autoFocus
            />
          </div>
          {results && results.tracks.slice(0, 12).map((t) => (
            <div key={t.id} className="soulseek-result" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 4 }}>
              <div className="item-body" style={{ minWidth: 0 }}>
                <div className="item-name">{t.title}</div>
                <div className="item-type">{t.artist?.name} · {t.album?.title}</div>
              </div>
              {existingIds.has(t.id)
                ? <span className="chip">Added</span>
                : <button className="sp-btn sp-btn--primary" style={{ padding: '4px 16px' }} onClick={() => add(t)}>Add</button>}
            </div>
          ))}
        </div>
      )}

      {tracks.length === 0 ? (
        <div className="empty" style={{ padding: '40px 32px' }}>Empty playlist. Add some tracks.</div>
      ) : (
        <div style={{ padding: '0 32px' }}>
          <TrackTable tracks={tracks} onRadio={radio} onRemove={remove} removable />
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
