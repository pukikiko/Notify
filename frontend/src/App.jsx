import React, { useState, useEffect, useCallback } from 'react'
import { AppProvider, useApp } from './store'
import { PlayerProvider } from './player'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import PlayerBar from './components/PlayerBar'
import AuthView from './views/AuthView'
import HomeView from './views/HomeView'
import SearchView from './views/SearchView'
import LibraryView from './views/LibraryView'
import ArtistView from './views/ArtistView'
import AlbumView from './views/AlbumView'
import PlaylistsView from './views/PlaylistsView'
import PlaylistView from './views/PlaylistView'
import SpotifyPlaylistView from './views/SpotifyPlaylistView'
import SpotifyProfileView from './views/SpotifyProfileView'
import SettingsView from './views/SettingsView'

function parseRoute() {
  const hash = window.location.hash.replace(/^#/, '')
  const [path, query] = hash.split('?')
  const parts = path.split('/').filter(Boolean)
  return { parts, query }
}

function useHashRoute() {
  const [route, setRoute] = useState(parseRoute)
  useEffect(() => {
    const onChange = () => setRoute(parseRoute())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const navigate = useCallback((to) => {
    window.location.hash = to
  }, [])
  return { route, navigate }
}

function Router() {
  const { route, navigate } = useHashRoute()
  const parts = route.parts
  const view = parts.length ? `/${parts[0]}` : '/'

  const render = () => {
    switch (view) {
      case '/': return <HomeView navigate={navigate} />
      case '/search': return <SearchView navigate={navigate} />
      case '/library': return <LibraryView navigate={navigate} />
      case '/playlists': return <PlaylistsView navigate={navigate} />
      case '/playlist':
        return String(parts[1]).startsWith('sp-')
          ? <SpotifyPlaylistView key={parts[1]} id={parts[1]} navigate={navigate} />
          : <PlaylistView key={parts[1]} id={parts[1]} navigate={navigate} />
      case '/profile':
        return <SpotifyProfileView key={parts[1]} id={parts[1]} navigate={navigate} />
      case '/artist': return <ArtistView key={parts[1]} id={parts[1]} navigate={navigate} />
      case '/album': return <AlbumView key={parts[1]} id={parts[1]} navigate={navigate} />
      case '/settings': return <SettingsView navigate={navigate} />
      default: return <HomeView navigate={navigate} />
    }
  }

  return (
    <div className="app">
      <div className="main-shell">
        <Sidebar view={view} navigate={navigate} />
        <div className="content">
          <TopBar view={view} navigate={navigate} />
          {render()}
        </div>
      </div>
      <PlayerBar />
    </div>
  )
}

function Shell() {
  const { user, loading } = useApp()
  if (loading) return <div className="app"><div className="content"><div className="spinner" /></div></div>
  if (!user) return <AuthView />
  return <PlayerProvider><Router /></PlayerProvider>
}

export default function App() {
  return <AppProvider><Shell /></AppProvider>
}
