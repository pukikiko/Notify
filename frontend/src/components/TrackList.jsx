import React from 'react'
import { usePlayer } from '../player'
import { api } from '../api'
import { PlayIcon, PauseIcon, HeartIcon, HeartFilledIcon, ClockIcon, DownloadIcon } from '../icons'

function fmtTime(s) {
  if (!s || isNaN(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60).toString().padStart(2, '0')
  return `${m}:${sec}`
}

function ItemLink({ text, to }) {
  if (!text) return <span className="tr-cell-link">—</span>
  if (!to) return <span className="tr-cell-link">{text}</span>
  return (
    <a className="tr-cell-link" href={`#${to}`} onClick={(e) => e.stopPropagation()}>
      {text}
    </a>
  )
}

/** Spotify-style tracklist for artist/album pages. Clicking any row starts a
    queue from that row through the rest of the list: rows already cached play
    instantly, rows that are downloading auto-play once the server finishes, and
    rows that are only discoverable are resolved + downloaded on demand by the
    player (with the next track prefetched in the background). */
export default function TrackList({ tracks, showAlbum = true, showArtist = true, current }) {
  const { playQueue, toggle } = usePlayer()
  const [toast, setToast] = React.useState(null)

  const isDownloaded = (t) => !!t.streamUrl || typeof t.id === 'number'
  const isCurrent = (t) => current && (current.id === t.id || (current.mbid && t.mbid && current.mbid === t.mbid))

  const play = (e, idx) => {
    e.stopPropagation()
    const t = tracks[idx]
    if (!t) return
    if (isCurrent(t)) toggle()
    else playQueue(tracks, idx)
  }

  const like = async (e, track) => {
    e.stopPropagation()
    const res = await api(`/library/tracks/${track.id}/like`, { method: 'POST' })
    track.liked = res.liked
    setToast(res.liked ? 'Added to Liked Songs' : 'Removed from Liked Songs')
    setTimeout(() => setToast(null), 1800)
  }

  if (!tracks || !tracks.length) return null

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
            const dl = isDownloaded(track)
            const isCurrent = current && (current.id === track.id || (current.mbid && track.mbid && current.mbid === track.mbid))
            return (
              <tr key={track.id || track.mbid || idx} className={isCurrent ? 'playing' : ''} onClick={(e) => play(e, idx)}>
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
                      {(track.artUrl || track.image) ? <img src={track.artUrl || track.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
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
                  <td>
                    {dl
                      ? <ItemLink text={track.artist?.name} to={`/artist/${track.artist?.id}`} />
                      : <span className="tr-cell-link">{track.artist?.name || '—'}</span>}
                  </td>
                )}
                {showAlbum && (
                  <td>
                    {dl
                      ? <ItemLink text={track.album?.title} to={`/album/${track.album?.id}`} />
                      : <span className="tr-cell-link">{track.album?.title || '—'}</span>}
                  </td>
                )}
                <td className="tr-duration">{fmtTime(track.duration)}</td>
                <td className="tr-actions">
                  {dl && (
                    <>
                      <button
                        className={`sp-icon-btn like ${track.liked ? 'heart-on' : ''}`}
                        title={track.liked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
                        onClick={(e) => like(e, track)}
                      >
                        {track.liked ? <HeartFilledIcon size={16} /> : <HeartIcon size={16} />}
                      </button>
                    </>
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
