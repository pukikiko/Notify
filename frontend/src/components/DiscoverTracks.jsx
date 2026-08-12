import React from 'react'
import { PlayIcon, PauseIcon } from '../icons'

function fmtTime(s) {
  if (!s || isNaN(s)) return ''
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60).toString().padStart(2, '0')
  return `${m}:${sec}`
}

const PROVIDER_LABEL = {
  youtubemusic: 'YouTube Music',
  soundcloud: 'SoundCloud'
}

/** Row list for Spotify/catalog tracks that aren't downloaded yet.
    Clicking a row plays it through the rest of the list (onPlay(track, index));
    the player resolves + downloads each track as it comes up. */
export default function DiscoverTracks({ tracks, onPlay, current, showAlbum = false }) {
  if (!tracks || !tracks.length) return null
  return (
    <table className="sp-tracklist">
      <tbody>
        {tracks.map((t, i) => {
          const isCurrent = !!current && !!t.mbid && current.mbid === t.mbid
          return (
            <tr key={t.id || t.mbid || i} onClick={() => onPlay(t, i)}>
              <td className="tr-index">
                <span className="idx-num">{i + 1}</span>
                <span className="idx-play">
                  {isCurrent && current.status === 'available' ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
                </span>
              </td>
              <td className="tr-title">
                <div className="tr-title-cell">
                  <span className="track-art">
                    {(t.image || t.artUrl) ? <img src={t.image || t.artUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
                  </span>
                  <span className="tt">
                    <div className="tr-title">{t.title}</div>
                    <div className="tr-cell-link">
                      {t.artist?.name || ''}
                      {t.provider && (
                        <span className={`web-source-badge web-source-badge--${t.provider}`}>{PROVIDER_LABEL[t.provider] || t.provider}</span>
                      )}
                    </div>
                  </span>
                </div>
              </td>
              {showAlbum && (
                <td><span className="tr-cell-link">{t.album?.title || '—'}</span></td>
              )}
              <td className="tr-duration">{fmtTime(t.duration)}</td>
              <td className="tr-actions" style={{ width: 48 }}></td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
