import React, { useState } from 'react'
import Artwork from './Artwork'
import { usePlayer } from '../player'
import { api } from '../api'
import { PlayIcon } from '../icons'

export function Card({ art, name, meta, onClick, onPlay, playing, rounded, playBtn }) {
  return (
    <div className="sp-card" onClick={onClick}>
      <Artwork src={art} alt={name} rounded={rounded} />
      <div className="name">{name}</div>
      <div className="meta">{meta}</div>
      {onPlay && (
        <div className={`card-play ${playing ? 'playing' : ''}`} onClick={(e) => { e.stopPropagation(); onPlay() }}>
          <div className="play-fab">{playBtn || <PlayIcon />}</div>
        </div>
      )}
    </div>
  )
}

export function ArtistCard({ artist }) {
  const { playQueue, current } = usePlayer()

  const play = async () => {
    const { tracks } = await api(`/library/artists/${artist.id}`)
    if (tracks.length) playQueue(tracks, 0)
  }

  const playing = current?.artist?.id === artist.id

  return (
    <Card
      art={artist.image}
      name={artist.name}
      meta={`Artist · ${artist.trackCount || 0} songs`}
      rounded
      playing={playing}
      onClick={() => { window.location.hash = `/artist/${artist.id}` }}
      onPlay={play}
      playBtn={<PlayIcon />}
    />
  )
}

export function AlbumCard({ album }) {
  const { playQueue, current } = usePlayer()

  // Discover albums (not in the library yet) resolve their full tracklist
  // through the discover endpoint; the player downloads each track on demand.
  const isDiscover = !/^\d+$/.test(String(album.id))

  const play = async () => {
    if (isDiscover) {
      const key = album.mbid || (String(album.id).startsWith('sp-') ? String(album.id).slice(3) : String(album.id))
      const d = await api(`/discover/album/${encodeURIComponent(key)}`)
      if (d.tracks?.length) playQueue(d.tracks, 0)
      return
    }
    const { tracks } = await api(`/library/albums/${album.id}`)
    if (tracks.length) playQueue(tracks, 0)
  }

  const playing = current?.album?.id === album.id

  return (
    <Card
      art={album.image}
      name={album.title}
      meta={`${album.year || ''} · Album`}
      playing={playing}
      onClick={() => { window.location.hash = `/album/${album.id}` }}
      onPlay={play}
    />
  )
}

export function PlaylistCard({ playlist, onOpen }) {
  return (
    <Card
      name={playlist.name}
      meta={`${playlist.trackCount || 0} songs`}
      onClick={() => onOpen(playlist.id)}
    />
  )
}
