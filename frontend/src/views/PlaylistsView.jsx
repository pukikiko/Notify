import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { PlaylistCard } from '../components/Cards'

export default function PlaylistsView({ navigate }) {
  const [playlists, setPlaylists] = useState(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  useEffect(() => { api('/playlists').then((r) => setPlaylists(r.playlists)) }, [])

  const create = async () => {
    if (!name.trim()) return
    const { playlist } = await api('/playlists', { method: 'POST', body: { name } })
    setName('')
    setCreating(false)
    api('/playlists').then((r) => setPlaylists(r.playlists))
    navigate(`/playlist/${playlist.id}`)
  }

  return (
    <div className="page">
      <h1 className="page-title" style={{ marginTop: 12 }}>Playlists</h1>
      <div className="header-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <p className="text-sub" style={{ margin: 0 }}>Curate your own collections.</p>
        <button className="sp-btn sp-btn--ghost" onClick={() => setCreating(!creating)}>{creating ? 'Cancel' : '+ New playlist'}</button>
      </div>

      {creating && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, maxWidth: 480 }}>
          <input
            placeholder="Playlist name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            style={{ borderBottom: '1px solid #fff', flex: 1 }}
            autoFocus
          />
          <button className="sp-btn sp-btn--primary" onClick={create}>Create</button>
        </div>
      )}

      {playlists === null ? <div className="spinner" /> : playlists.length === 0 ? (
        <div className="empty">No playlists yet. Create one to get started.</div>
      ) : (
        <div className="grid">
          {playlists.map((p) => <PlaylistCard key={p.id} playlist={p} onOpen={(pid) => navigate(`/playlist/${pid}`)} />)}
        </div>
      )}
    </div>
  )
}
