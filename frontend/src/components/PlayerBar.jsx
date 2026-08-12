import React from 'react'
import { usePlayer } from '../player'
import { api } from '../api'
import {
  PlayIcon, PauseIcon, PrevIcon, NextIcon, ShuffleIcon, RepeatIcon, RepeatOneIcon,
  HeartIcon, HeartFilledIcon, VolumeIcon, QueueIcon, DevicesIcon, DownloadIcon, CloseIcon
} from '../icons'

function fmtTime(s) {
  if (!s || isNaN(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60).toString().padStart(2, '0')
  return `${m}:${sec}`
}

function Slider({ value, max, onChange, onCommit, className = '' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <input
      type="range"
      className={`sp-range ${className}`}
      min={0}
      max={max || 0}
      step={0.1}
      value={value || 0}
      onChange={(e) => onChange(Number(e.target.value))}
      onMouseUp={onCommit}
      onTouchEnd={onCommit}
      style={{ background: `linear-gradient(to right, var(--sp-text) ${pct}%, #4d4d4d ${pct}%)` }}
    />
  )
}

export default function PlayerBar() {
  const {
    current, playing, preparing, toggle, advance, seek, position, duration,
    shuffle, setShuffle, repeat, setRepeat, volume, setVolume, queue, loadIndex
  } = usePlayer()

  const [liked, setLiked] = React.useState(false)
  const [queueOpen, setQueueOpen] = React.useState(false)

  React.useEffect(() => { setLiked(!!current?.liked) }, [current])

  const art = current?.artUrl || current?.album?.image || current?.image
  // Only resolved library tracks have a numeric id / navigable artist+album.
  const resolved = !!current && typeof current.id === 'number'
  const albumHref = current?.album?.id ? `#/album/${current.album.id}` : null
  const artistHref = current?.artist?.id ? `#/artist/${current.artist.id}` : null

  const toggleLike = async () => {
    if (!current || typeof current.id !== 'number') return
    const res = await api(`/library/tracks/${current.id}/like`, { method: 'POST' }).catch(() => ({ liked: !liked }))
    setLiked(res.liked)
  }

  const repeatNext = () => setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off')

  return (
    <>
      <div className="player-bar">
        <div className="np-left">
          <div className="np-art">
            {art
              ? <img src={art} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4 }} />
              : <span style={{ fontSize: 22, opacity: 0.6 }}>♪</span>}
          </div>
          <div className="np-info">
            {current ? (
              <>
                <a className="np-title" href={albumHref || artistHref || '#'} onClick={(e) => { if (!albumHref && !artistHref) e.preventDefault() }} title={current.title}>{current.title}</a>
                {artistHref ? <a className="np-artist" href={artistHref}>{current.artist?.name}</a> : <div className="np-artist">{current.artist?.name || ''}</div>}
                {preparing && <div className="np-pending"><DownloadIcon size={12} style={{ verticalAlign: '-2px' }} /> Downloading…</div>}
              </>
            ) : (
              <div className="np-artist">Nothing playing</div>
            )}
          </div>
          {resolved && (
            <div className="np-actions">
              <button className={`sp-icon-btn ${liked ? 'heart-on' : ''}`} title="Save to Liked Songs" onClick={toggleLike}>
                {liked ? <HeartFilledIcon size={16} /> : <HeartIcon size={16} />}
              </button>
            </div>
          )}
        </div>

        <div className="np-center">
          <div className="player-controls">
            <button className={`ctrl ${shuffle ? 'active' : ''}`} title="Enable shuffle" onClick={() => setShuffle(!shuffle)}><ShuffleIcon /></button>
            <button className="ctrl" title="Previous" onClick={() => advance(-1)}><PrevIcon /></button>
            <button className="ctrl ctrl--play" title={playing ? 'Pause' : 'Play'} onClick={toggle}>
              {preparing ? <span className="spinner-mini" /> : (playing ? <PauseIcon /> : <PlayIcon />)}
            </button>
            <button className="ctrl" title="Next" onClick={() => advance(1)}><NextIcon /></button>
            <button className={`ctrl ${repeat !== 'off' ? 'active' : ''}`} title={`Repeat: ${repeat}`} onClick={repeatNext}>
              {repeat === 'one' ? <RepeatOneIcon /> : <RepeatIcon />}
            </button>
          </div>
          <div className="progress">
            <span>{fmtTime(position)}</span>
            <Slider value={position} max={duration} onChange={(v) => seek(v)} />
            <span>{fmtTime(duration)}</span>
          </div>
        </div>

        <div className="np-right">
          {queue.length > 0 && (
            <button className={`ctrl ${queueOpen ? 'active' : ''}`} title="Queue" onClick={() => setQueueOpen(!queueOpen)}><QueueIcon /></button>
          )}
          <button className={`ctrl ${queueOpen ? 'active' : ''}`} title="Now playing" onClick={() => setQueueOpen(!queueOpen)}><DevicesIcon /></button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <VolumeIcon size={18} />
            <Slider className="vol" value={volume} max={1} onChange={(v) => setVolume(v)} />
          </div>
        </div>
      </div>

      {queueOpen && queue.length > 0 && (
        <div className="queue-panel">
          <div className="queue-head">
            <span>Queue</span>
            <button className="sp-icon-btn" title="Close queue" onClick={() => setQueueOpen(false)}><CloseIcon size={18} /></button>
          </div>
          <div className="queue-list">
            {queue.map((t, i) => (
              <div key={t.id} className="library-item" onClick={() => loadIndex(i)}>
                <span className="item-art">
                  {(t.artUrl || t.album?.image || t.image) ? <img src={t.artUrl || t.album?.image || t.image} alt="" /> : <span style={{ fontSize: 16, opacity: 0.6 }}>♪</span>}
                </span>
                <span className="item-body">
                  <span className="item-name" style={{ color: i === 0 ? 'var(--sp-green)' : undefined }}>{t.title}</span>
                  <span className="item-type">{t.artist?.name}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
