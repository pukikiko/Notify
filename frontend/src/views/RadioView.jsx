import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { usePlayer } from '../player'
import TrackTable from '../components/TrackTable'
import { RadioIcon, RefreshIcon } from '../icons'

export default function RadioView() {
  const { playQueue, queue, current, radio } = usePlayer()
  const [kind, setKind] = useState('track')
  const [seed, setSeed] = useState('')
  const [items, setItems] = useState([])
  const [station, setStation] = useState(null)

  const loadItems = async (k) => {
    if (k === 'track') { const r = await api('/library/tracks'); return r.tracks }
    if (k === 'artist') { const r = await api('/library/artists'); return r.artists }
    if (k === 'album') { const r = await api('/library/albums'); return r.albums }
    if (k === 'playlist') { const r = await api('/playlists'); return r.playlists }
    return []
  }

  useEffect(() => {
    loadItems(kind).then(setItems)
    setSeed('')
  }, [kind])

  const start = async () => {
    if (!seed) return
    const { tracks } = await api(`/radio/seed?type=${kind}&id=${seed}&limit=60`)
    if (!tracks.length) return
    setStation(tracks)
    playQueue(tracks, 0, { radioSeed: { type: kind, id: Number(seed) } })
  }

  const label = kind === 'track' ? 'a track' : kind === 'artist' ? 'an artist' : kind === 'album' ? 'an album' : 'a playlist'

  return (
    <div className="page">
      <h1 className="page-title" style={{ marginTop: 12 }}>Radio</h1>
      <p className="text-sub" style={{ marginBottom: 24 }}>Start from {label} and Notify builds a station of similar music from the shared cache.</p>

      <div className="settings-block" style={{ maxWidth: 640 }}>
        <div className="sp-tabs" style={{ marginBottom: 16 }}>
          {['track', 'artist', 'album', 'playlist'].map((k) => (
            <button key={k} className={`sp-btn sp-btn--ghost ${kind === k ? 'sp-btn--primary' : ''}`} style={{ padding: '6px 16px' }} onClick={() => setKind(k)}>
              {k === 'track' ? 'Track' : k === 'artist' ? 'Artist' : k === 'album' ? 'Album' : 'Playlist'}
            </button>
          ))}
        </div>
        <select className="sp-select" value={seed} onChange={(e) => setSeed(e.target.value)} style={{ marginBottom: 16 }}>
          <option value="">Select {label}…</option>
          {items.map((it) => (
            <option key={it.id} value={it.id}>{it.name || it.title || it.username}</option>
          ))}
        </select>
        <div>
          <button className="sp-btn sp-btn--primary" onClick={start} disabled={!seed}>
            <RadioIcon size={16} /> Start radio
          </button>
        </div>
      </div>

      {radio && current && (
        <div className="radio-flag" style={{ marginBottom: 10 }}>
          <RadioIcon size={16} /> Now playing: {current.title} — {current.artist?.name}
        </div>
      )}

      {queue.length > 0 && (
        <>
          <div className="section-title--row section-title">
            <span>Station queue ({queue.length})</span>
            <button className="more-link" style={{ border: 'none', background: 'none', color: 'var(--sp-text-sub)', cursor: 'pointer', fontWeight: 700 }} onClick={start}><RefreshIcon size={14} style={{ verticalAlign: '-2px' }} /> Refresh</button>
          </div>
          <TrackTable tracks={queue} />
        </>
      )}

      {!queue.length && !radio && (
        <div className="empty">Pick a seed and hit start to generate your station.</div>
      )}
    </div>
  )
}
