import React from 'react'
import { usePlayer } from '../player'
import { api } from '../api'
import { PlayIcon, PauseIcon, HeartIcon, HeartFilledIcon, RadioIcon, ClockIcon, DownloadIcon, CloseIcon } from '../icons'

function fmtTime(s) {
  if (!s || isNaN(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60).toString().padStart(2, '0')
  return `${m}:${sec}`
}

function ItemLink({ text, to }) {
  if (!text) return <span className="tr-cell-link">—</span>
  if (!to || to.includes('undefined') || to.includes('null')) return <span className="tr-cell-link">{text}</span>
  return (
    <a className="tr-cell-link" href={`#${to}`} onClick={(e) => e.stopPropagation()}>
      {text}
    </a>
  )
}

export default function TrackTable({ tracks, showAlbum = true, showArtist = true, onRadio, context = 'track', removable, onRemove }) {
  const { playQueue, current, toggle } = usePlayer()
  const [toast, setToast] = React.useState(null)

  const play = (e, idx) => {
    e.stopPropagation()
    if (current && current.id === tracks[idx].id) toggle()
    else playQueue(tracks, idx)
  }

  const like = async (e, track) => {
    e.stopPropagation()
    const res = await api(`/library/tracks/${track.id}/like`, { method: 'POST' })
    track.liked = res.liked
    setToast(res.liked ? 'Added to Liked Songs' : 'Removed from Liked Songs')
    setTimeout(() => setToast(null), 1800)
  }

  const radio = async (e, track) => {
    e.stopPropagation()
    if (onRadio) return onRadio(track)
    const { tracks: station } = await api(`/radio/seed?type=track&id=${track.id}&limit=50`)
    if (station.length) playQueue(station, 0, { radioSeed: { type: 'track', id: track.id } })
  }

  return (
    <>
      {toast && <div className="toast">{toast}</div>}
      <table className="sp-tracklist">
        <thead>
          <tr>
            <th style={{ width: 40, textAlign: 'center' }}>#</th>
            <th>Title</th>
            {showArtist && <th>Artist</th>}
            {showAlbum && <th>Album</th>}
            <th style={{ width: 60, textAlign: 'right' }}><ClockIcon size={14} /></th>
            <th style={{ width: 90, textAlign: 'right' }}></th>
          </tr>
        </thead>
        <tbody>
          {tracks.map((track, idx) => {
            const isCurrent = current?.id === track.id
            return (
              <tr key={track.id} className={isCurrent ? 'playing' : ''} onClick={(e) => play(e, idx)}>
                <td className="tr-index">
                  <span className="idx-num">{isCurrent ? '' : idx + 1}</span>
                  <span className="idx-play">
                    {isCurrent
                      ? (track.status === 'available' ? <PauseIcon size={16} /> : <span className="spinner-mini" />)
                      : <PlayIcon size={16} />}
                  </span>
                </td>
                <td className="tr-title">
                  <div className="tr-title-cell">
                    <span className="track-art">
                      {(track.artUrl || track.album?.image || track.image) ? <img src={track.artUrl || track.album?.image || track.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
                    </span>
                    <span className="tt">
                      <div className="tr-title">{track.title}</div>
                      {track.status === 'downloading' && (
                        <div className="tr-cell-link" style={{ fontSize: 11, color: 'var(--sp-green)' }}>
                          <DownloadIcon size={11} style={{ verticalAlign: '-1px' }} /> downloading
                        </div>
                      )}
                    </span>
                  </div>
                </td>
                {showArtist && (
                  <td><ItemLink text={track.artist?.name} to={track.artist?.id ? `/artist/${track.artist.id}` : null} /></td>
                )}
                {showAlbum && (
                  <td><ItemLink text={track.album?.title} to={track.album?.id ? `/album/${track.album.id}` : null} /></td>
                )}
                <td className="tr-duration">{fmtTime(track.duration)}</td>
                <td className="tr-actions">
                  <button
                    className={`sp-icon-btn like ${track.liked ? 'heart-on' : ''}`}
                    title={track.liked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
                    onClick={(e) => like(e, track)}
                  >
                    {track.liked ? <HeartFilledIcon size={16} /> : <HeartIcon size={16} />}
                  </button>
                  <button className="sp-icon-btn" title="Track radio" onClick={(e) => radio(e, track)}>
                    <RadioIcon size={16} />
                  </button>
                  {removable && (
                    <button className="sp-icon-btn" title="Remove from playlist" onClick={(e) => { e.stopPropagation(); onRemove && onRemove(track.id) }}>
                      <CloseIcon size={16} />
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}
