import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { usePlayer } from '../player'
import Artwork from './Artwork'
import { PlayIcon, PauseIcon, ArrowLeftIcon, ArrowRightIcon } from '../icons'

const AUTO_MS = 6000

function hashHue(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360
  return h
}

/** Full-width rotating showcase of popular artists. Auto-advances every few
    seconds, supports manual navigation (arrows + dots), and pauses on hover. */
export default function ArtistShowcase({ artists, navigate }) {
  const { playQueue, current } = usePlayer()
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const count = artists.length

  useEffect(() => {
    if (paused || count <= 1) return
    const t = setInterval(() => setIndex((i) => (i + 1) % count), AUTO_MS)
    return () => clearInterval(t)
  }, [paused, count, index])

  if (!count) return null
  const artist = artists[index]
  const hue = hashHue(artist.name)
  const playing = current?.artist?.id === artist.id

  const play = async (e) => {
    e.stopPropagation()
    const { tracks } = await api(`/library/artists/${artist.id}`)
    if (tracks.length) playQueue(tracks, 0)
  }

  const go = (delta) => setIndex((i) => (i + delta + count) % count)
  const select = (i) => setIndex(i)

  // Wikipedia artwork fills the card background; the artist's own Spotify
  // photo stays as the circular portrait so it's never lost.
  const bg = artist.wikiImage
  const style = bg
    ? {
        backgroundImage: `linear-gradient(135deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.3) 100%), url(${bg})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center 25%'
      }
    : { background: `linear-gradient(135deg, hsl(${hue} 55% 30%) 0%, hsl(${hue} 45% 18%) 60%, #181818 100%)` }

  return (
    <div className="artist-showcase" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="artist-feature" style={style} onClick={() => navigate(`/artist/${artist.id}`)}>
        <button className="as-nav as-nav--prev" title="Previous artist" onClick={(e) => { e.stopPropagation(); go(-1) }}>
          <ArrowLeftIcon />
        </button>

        <Artwork src={artist.image} alt={artist.name} className="af-art" rounded />

        <div className="af-body">
          <div className="af-label">Popular artist</div>
          <div className="af-name">{artist.name}</div>
          <div className="af-meta">
            {artist.genres?.slice(0, 3).join(' · ') || 'Artist'}
            {artist.trackCount > 0 && <span className="sep"> · </span>}
            {artist.trackCount > 0 && `${artist.trackCount} ${artist.trackCount === 1 ? 'song' : 'songs'}`}
            {artist.trackCount > 0 && artist.albumCount > 0 ? ', ' : ''}
            {artist.albumCount > 0 && `${artist.albumCount} ${artist.albumCount === 1 ? 'album' : 'albums'}`}
          </div>
          {artist.bio && <div className="af-bio">{artist.bio}</div>}
        </div>

        <div className={`af-play ${playing ? 'playing' : ''}`} onClick={play}>
          <div className="play-fab">{playing ? <PauseIcon /> : <PlayIcon />}</div>
        </div>

        <button className="as-nav as-nav--next" title="Next artist" onClick={(e) => { e.stopPropagation(); go(1) }}>
          <ArrowRightIcon />
        </button>
      </div>

      <div className="as-dots">
        {artists.map((a, i) => (
          <button
            key={a.id}
            className={`as-dot ${i === index ? 'active' : ''}`}
            title={`Show ${a.name}`}
            onClick={() => select(i)}
          />
        ))}
      </div>
    </div>
  )
}
