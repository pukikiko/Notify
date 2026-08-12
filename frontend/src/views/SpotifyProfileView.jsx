import React, { useEffect, useState } from 'react'
import { api } from '../api'
import Artwork from '../components/Artwork'
import { Card } from '../components/Cards'
import { PlayIcon, DotsIcon } from '../icons'

function hashHue(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360
  return h
}

function fmtCount(n) {
  if (n == null) return ''
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`
  return String(n)
}

export default function SpotifyProfileView({ id, navigate }) {
  const [data, setData] = useState(null)

  const decoded = (() => { try { return decodeURIComponent(id || '') } catch { return id || '' } })()
  const spotifyId = decoded.startsWith('sp-') ? decoded.slice(3) : decoded

  useEffect(() => {
    api(`/discover/user/${encodeURIComponent(spotifyId)}`)
      .then(setData)
      .catch(() => setData({ error: true }))
  }, [spotifyId])

  if (!data) return <div className="page"><div className="spinner" /></div>
  if (data.error || !data.user) return <div className="page"><div className="empty">Profile not found</div></div>

  const { user, playlists } = data
  const hue = hashHue(user.name)

  return (
    <div className="page page-with-hero">
      <div className="page-hero-bg" style={{ background: `linear-gradient(180deg, hsl(${hue} 45% 18%) 0%, hsl(${hue} 30% 12%) 45%, var(--sp-bg-base) 100%)`, height: 300 }} />
      <div className="hero">
        <Artwork src={user.image} alt={user.name} className="hero-art rounded" rounded />
        <div className="hero-info">
          <div className="hero-label">Profile</div>
          <h1 className="hero-title">{user.name}</h1>
          <div className="hero-meta">
            <span>{user.followers != null ? `${fmtCount(user.followers)} followers` : 'Spotify user'}</span>
            {user.spotifyUrl && (
              <>
                <span className="sep">·</span>
                <a className="tr-cell-link" href={user.spotifyUrl} target="_blank" rel="noreferrer">Open on Spotify</a>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="action-row">
        <button className="sp-icon-btn" style={{ width: 40, height: 40 }} title="More"><DotsIcon size={24} /></button>
      </div>

      {playlists.length === 0 ? (
        <div className="empty" style={{ padding: '40px 32px' }}>No public playlists.</div>
      ) : (
        <div style={{ padding: '0 32px' }}>
          <h2 className="section-title" style={{ marginTop: 0 }}>Public playlists</h2>
          <div className="grid">
            {playlists.map((p) => (
              <Card
                key={p.id}
                art={p.image}
                name={p.name}
                meta={`${p.trackCount || 0} songs`}
                onClick={() => navigate(`/playlist/sp-${p.id}`)}
                playBtn={<PlayIcon />}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
