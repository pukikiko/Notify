import React, { useEffect, useState } from 'react'
import { api } from '../api'
import TrackTable from '../components/TrackTable'
import { ArtistCard, AlbumCard } from '../components/Cards'
import { HeartFilledIcon } from '../icons'

export default function LibraryView({ navigate }) {
  const [tab, setTab] = useState('tracks')
  const [tracks, setTracks] = useState(null)
  const [albums, setAlbums] = useState(null)
  const [artists, setArtists] = useState(null)

  useEffect(() => {
    const load = async () => {
      const [t, al, ar] = await Promise.all([
        api('/library/liked/tracks'),
        api('/library/liked/albums'),
        api('/library/liked/artists')
      ])
      setTracks(t.tracks)
      setAlbums(al.albums)
      setArtists(ar.artists)
    }
    load()
  }, [])

  const totalDuration = (tracks || []).reduce((n, t) => n + (t.duration || 0), 0)

  return (
    <div className="page">
      <div className="page-hero-bg" style={{ background: 'linear-gradient(180deg, rgba(70,90,200,0.45) 0%, rgba(18,18,18,0) 100%)', height: 300 }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div className="hero" style={{ padding: '40px 8px 20px' }}>
          <div className="hero-art" style={{ background: 'linear-gradient(135deg, #450af5, #c4efd9)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <HeartFilledIcon size={72} />
          </div>
          <div className="hero-info">
            <div className="hero-label">Playlist</div>
            <h1 className="hero-title">Liked Songs</h1>
            <div className="hero-meta">
              <span>{tracks ? `${tracks.length} songs` : '…'}</span>
              {tracks && tracks.length > 0 && <><span className="sep">·</span> <span>{Math.round(totalDuration / 60)} min</span></>}
            </div>
          </div>
        </div>

        <div className="sp-tabs" style={{ marginBottom: 20 }}>
          <button className={`sp-btn sp-btn--ghost ${tab === 'tracks' ? 'sp-btn--primary' : ''}`} style={{ padding: '6px 16px' }} onClick={() => setTab('tracks')}>Songs</button>
          <button className={`sp-btn sp-btn--ghost ${tab === 'albums' ? 'sp-btn--primary' : ''}`} style={{ padding: '6px 16px' }} onClick={() => setTab('albums')}>Albums</button>
          <button className={`sp-btn sp-btn--ghost ${tab === 'artists' ? 'sp-btn--primary' : ''}`} style={{ padding: '6px 16px' }} onClick={() => setTab('artists')}>Artists</button>
        </div>

        {tab === 'tracks' && (tracks === null ? <div className="spinner" /> :
          tracks.length ? <TrackTable tracks={tracks} /> : <div className="empty">No liked tracks yet. Tap the heart on any track.</div>)}

        {tab === 'albums' && (albums === null ? <div className="spinner" /> :
          albums.length ? <div className="grid">{albums.map((a) => <AlbumCard key={a.id} album={a} />)}</div>
            : <div className="empty">No liked albums yet.</div>)}

        {tab === 'artists' && (artists === null ? <div className="spinner" /> :
          artists.length ? <div className="grid">{artists.map((a) => <ArtistCard key={a.id} artist={a} />)}</div>
            : <div className="empty">No liked artists yet.</div>)}
      </div>
    </div>
  )
}
