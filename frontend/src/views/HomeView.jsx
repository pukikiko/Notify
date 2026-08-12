import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { useApp } from '../store'
import { usePlayer } from '../player'
import TrackTable from '../components/TrackTable'
import { ArtistCard, AlbumCard } from '../components/Cards'
import Artwork from '../components/Artwork'
import { DownloadIcon } from '../icons'

export default function HomeView() {
  const { user, status } = useApp()
  const { playQueue } = usePlayer()
  const [recent, setRecent] = useState(null)
  const [artists, setArtists] = useState(null)
  const [albums, setAlbums] = useState(null)
  const [liked, setLiked] = useState(null)
  const [downloads, setDownloads] = useState([])

  useEffect(() => {
    const load = async () => {
      const [t, a, al, l, dl] = await Promise.all([
        api('/library/tracks'),
        api('/library/artists'),
        api('/library/albums'),
        api('/library/liked/tracks'),
        api('/library/downloads')
      ])
      setRecent(t.tracks.slice(0, 8))
      setArtists(a.artists.slice(0, 8))
      setAlbums(al.albums.slice(0, 10))
      setLiked(l.tracks.slice(0, 10))
      setDownloads(dl.downloads)
    }
    load()
    const t = setInterval(async () => {
      const dl = await api('/library/downloads').catch(() => ({ downloads: [] }))
      setDownloads(dl.downloads)
    }, 4000)
    return () => clearInterval(t)
  }, [])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="page">
      <div className="page-hero-bg" style={{ background: 'linear-gradient(180deg, rgba(30,215,96,0.35) 0%, rgba(18,18,18,0) 100%)', height: 300 }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <h1 className="page-title" style={{ marginTop: 12 }}>{greeting}</h1>

        {downloads.length > 0 && (
          <>
            <h2 className="section-title">Downloading</h2>
            <div className="chip-row" style={{ marginBottom: 12 }}>
              {downloads.map((d) => (
                <span key={d.id} className="chip"><DownloadIcon size={13} /> {d.title}</span>
              ))}
            </div>
          </>
        )}

        {recent && recent.length > 0 && (
          <>
            <h2 className="section-title">Recently added</h2>
            <div className="pill-grid">
              {recent.map((t) => (
                <div key={t.id} className="pill-card" onClick={() => playQueue([t], 0)}>
                  <Artwork src={t.artUrl} alt={t.title} style={{ width: 48, height: 48, borderRadius: 0 }} />
                  <span className="name">{t.title}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {albums && albums.length > 0 && (
          <>
            <h2 className="section-title">Albums</h2>
            <div className="grid">
              {albums.map((a) => <AlbumCard key={a.id} album={a} />)}
            </div>
          </>
        )}

        {artists && artists.length > 0 && (
          <>
            <h2 className="section-title">Your favorite artists</h2>
            <div className="grid">
              {artists.map((a) => <ArtistCard key={a.id} artist={a} />)}
            </div>
          </>
        )}

        {liked && liked.length > 0 && (
          <>
            <h2 className="section-title">Liked Songs</h2>
            <TrackTable tracks={liked} showAlbum={false} />
          </>
        )}

        {recent && recent.length === 0 && (
          <div className="empty">
            Nothing cached yet. Go to Search, type an artist or album, and hit play — Notify downloads it automatically.
          </div>
        )}
      </div>
    </div>
  )
}
