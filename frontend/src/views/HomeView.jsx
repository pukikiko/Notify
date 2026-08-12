import React, { useEffect, useState } from 'react'
import { api } from '../api'
import TrackTable from '../components/TrackTable'
import { AlbumCard } from '../components/Cards'
import ArtistShowcase from '../components/ArtistShowcase'
import { DownloadIcon } from '../icons'

function Section({ title, children }) {
  return (
    <section className="home-section">
      <h2 className="section-title">{title}</h2>
      {children}
    </section>
  )
}

function CardRow({ children }) {
  return <div className="card-row">{children}</div>
}

export default function HomeView({ navigate }) {
  const [data, setData] = useState(null)
  const [downloads, setDownloads] = useState([])

  useEffect(() => {
    api('/library/home')
      .then(setData)
      .catch(() => setData({ popularTracks: [], popularAlbums: [], popularArtists: [], recentAlbums: [], recentTracks: [], liked: [] }))
    const t = setInterval(async () => {
      const dl = await api('/library/downloads').catch(() => ({ downloads: [] }))
      setDownloads(dl.downloads)
    }, 4000)
    return () => clearInterval(t)
  }, [])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  const popular = data?.popularTracks || []
  const hasAny = data && (popular.length || data.popularAlbums.length || data.popularArtists.length || data.recentAlbums.length || data.liked.length)

  return (
    <div className="page">
      <div className="page-hero-bg" style={{ background: 'linear-gradient(180deg, rgba(143,92,255,0.35) 0%, rgba(18,18,18,0) 100%)', height: 300 }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <h1 className="page-title" style={{ marginTop: 12 }}>{greeting}</h1>

        {downloads.length > 0 && (
          <div className="chip-row" style={{ marginBottom: 16 }}>
            {downloads.map((d) => (
              <span key={d.id} className="chip"><DownloadIcon size={13} /> {d.title}</span>
            ))}
          </div>
        )}

        {!data && <div className="spinner" />}

        {data && data.popularArtists.length > 0 && (
          <Section title="Popular artists">
            <ArtistShowcase artists={data.popularArtists} navigate={navigate} />
          </Section>
        )}

        {data && data.popularAlbums.length > 0 && (
          <Section title="Popular albums">
            <CardRow>
              {data.popularAlbums.map((a) => <AlbumCard key={a.id} album={a} />)}
            </CardRow>
          </Section>
        )}

        {data && data.recentAlbums.length > 0 && (
          <Section title="Recently added albums">
            <CardRow>
              {data.recentAlbums.map((a) => <AlbumCard key={a.id} album={a} />)}
            </CardRow>
          </Section>
        )}

        {popular.length > 0 && (
          <Section title="Popular songs">
            <TrackTable tracks={popular} />
          </Section>
        )}

        {data && data.liked.length > 0 && (
          <Section title="Liked songs">
            <TrackTable tracks={data.liked} showAlbum={false} />
          </Section>
        )}

        {data && !hasAny && (
          <div className="empty">
            Nothing cached yet. Go to Search, type an artist or album, and hit play — Notify downloads it automatically.
          </div>
        )}
      </div>
    </div>
  )
}
