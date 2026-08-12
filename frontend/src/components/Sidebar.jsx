import React, { useEffect, useState, useCallback } from 'react'
import { useApp } from '../store'
import { api } from '../api'
import {
  NotifyLogo, HomeIcon, SearchIcon, LibraryIcon, PlusIcon, HeartFilledIcon, LogoutIcon
} from '../icons'

function LibraryItem({ art, name, type, active, onClick }) {
  return (
    <button className={`library-item ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="item-art">{art || <LibraryIcon size={18} />}</span>
      <span className="item-body">
        <span className="item-name">{name}</span>
        <span className="item-type">{type}</span>
      </span>
    </button>
  )
}

export default function Sidebar({ view, navigate }) {
  const { user, status, logout } = useApp()
  const [playlists, setPlaylists] = useState([])
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    api('/playlists').then((r) => setPlaylists(r.playlists)).catch(() => {})
  }, [])

  const open = useCallback((to) => {
    navigate(to)
  }, [navigate])

  const isPlaylist = view === '/playlist'
  const isLibrary = view === '/library'

  const filtered = playlists.filter((p) => {
    if (filter === 'playlists') return true
    if (filter === 'artists') return false
    return true
  })

  return (
    <div className="sidebar">
      <div className="sidebar-top">
        <div className="logo" onClick={() => open('/')} style={{ cursor: 'pointer' }}>
          <NotifyLogo /><span>Notify</span>
        </div>
        <button className={`sidebar-nav-item ${view === '/' ? 'active' : ''}`} onClick={() => open('/')}>
          <span className="icon"><HomeIcon /></span> Home
        </button>
        <button className={`sidebar-nav-item ${view === '/search' ? 'active' : ''}`} onClick={() => open('/search')}>
          <span className="icon"><SearchIcon /></span> Search
        </button>
      </div>

      <div className="library-panel">
        <div className="library-panel-head">
          <span className="lib-title">
            <LibraryIcon size={24} /> Your Library
          </span>
          <button className="lib-icon-btn" title="New playlist" onClick={() => open('/playlists')}><PlusIcon size={18} /></button>
        </div>
        <div className="library-filter">
          <button className={`filter-chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All</button>
          <button className={`filter-chip ${filter === 'playlists' ? 'active' : ''}`} onClick={() => setFilter('playlists')}>Playlists</button>
          <button className={`filter-chip ${filter === 'liked' ? 'active' : ''}`} onClick={() => setFilter('liked')}>Liked</button>
        </div>
        <div className="library-list">
          <LibraryItem
            art={<HeartFilledIcon size={18} />}
            name="Liked Songs"
            type="Playlist"
            active={isLibrary}
            onClick={() => open('/library')}
          />
          {filter !== 'liked' && filtered.map((p) => (
            <LibraryItem
              key={p.id}
              name={p.name}
              type={`Playlist · ${p.trackCount} songs`}
              active={isPlaylist && window.location.hash.includes(`/playlist/${p.id}`)}
              onClick={() => open(`/playlist/${p.id}`)}
            />
          ))}
        </div>
      </div>

      <div className="sidebar-bottom-row">
        <div className="sidebar-status">
          <span className={`status-dot ${status?.soulseek?.connected ? 'on' : status?.soulseek?.mode === 'mock' ? 'mid' : 'off'}`} />
          {status?.soulseek?.mode || '…'}{status?.soulseek?.connected ? ' · connected' : ''}
        </div>
        <button className="logout-btn" title={`Log out (${user?.username})`} onClick={logout}><LogoutIcon size={18} /></button>
      </div>
    </div>
  )
}
