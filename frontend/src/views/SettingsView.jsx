import React, { useEffect, useState } from 'react'
import { useApp } from '../store'
import { api } from '../api'
import { HeartFilledIcon, DownloadIcon, LibraryIcon, RefreshIcon } from '../icons'

function fmtBytes(n) {
  if (!n) return '0 B'
  if (n > 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`
  if (n > 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024).toFixed(0)} KB`
}

export default function SettingsView() {
  const { user, status, updateSettings, refreshStatus } = useApp()
  const [format, setFormat] = useState(user?.settings?.preferredFormat || 'mp3-320')
  const [saved, setSaved] = useState(false)
  const [counts, setCounts] = useState(null)

  useEffect(() => { setFormat(user?.settings?.preferredFormat || 'mp3-320') }, [user?.settings?.preferredFormat])

  useEffect(() => {
    api('/status/user').then((c) => setCounts(c)).catch(() => {})
  }, [])

  const save = async () => {
    await updateSettings({ preferredFormat: format })
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
  }

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <h1 className="page-title" style={{ marginTop: 12 }}>Settings</h1>
      <p className="text-sub" style={{ marginBottom: 24 }}>Configure your playback and account.</p>

      <div className="settings-block">
        <h2>Streaming format</h2>
        <p className="desc">Your preferred codec. The first time you play a track it's transcoded once into this format and cached — every user who chooses the same format shares the same cached file.</p>
        <div className="field">
          <label>Preferred format</label>
          <select className="sp-select" value={format} onChange={(e) => setFormat(e.target.value)}>
            {status && Object.entries(status.formats || {}).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
        <button className="sp-btn sp-btn--primary" onClick={save}>{saved ? '✓ Saved' : 'Save'}</button>
      </div>

      <div className="settings-block">
        <h2>Account</h2>
        <p className="desc"><strong>{user?.username}</strong></p>
        <div className="chip-row">
          <span className="chip"><HeartFilledIcon size={13} /> {counts?.likedTracks ?? 0} songs</span>
          <span className="chip"><HeartFilledIcon size={13} /> {counts?.likedArtists ?? 0} artists</span>
          <span className="chip"><HeartFilledIcon size={13} /> {counts?.likedAlbums ?? 0} albums</span>
          <span className="chip"><LibraryIcon size={13} /> {counts?.playlists ?? 0} playlists</span>
        </div>
      </div>

      <div className="settings-block">
        <h2>Music sources</h2>
        <p className="desc">Tracks are pulled from Soulseek first; if one can't be found there it falls back to YouTube Music and SoundCloud (via yt-dlp) so nothing is unplayable.</p>
        <div className="chip-row" style={{ marginBottom: 14 }}>
          <span className="chip">
            <span className={`status-dot ${status?.soulseek?.connected ? 'on' : status?.soulseek?.mode === 'mock' ? 'mid' : 'off'}`} />
            {' '}Soulseek: <strong>{status?.soulseek?.mode}</strong>
            {status?.soulseek?.username ? ` (${status.soulseek.username})` : ''}
          </span>
          <span className="chip">
            <span className={`status-dot ${status?.sources?.youtube?.enabled ? 'on' : 'off'}`} />
            {' '}YouTube Music: <strong>{status?.sources?.youtube?.enabled ? 'enabled' : 'disabled'}</strong>
          </span>
          <span className="chip">
            <span className={`status-dot ${status?.sources?.soundcloud?.enabled ? 'on' : 'off'}`} />
            {' '}SoundCloud: <strong>{status?.sources?.soundcloud?.enabled ? 'enabled' : 'disabled'}</strong>
          </span>
        </div>
        <button className="sp-btn sp-btn--ghost" onClick={refreshStatus}><RefreshIcon size={16} /> Refresh status</button>
      </div>

      <div className="settings-block">
        <h2>Shared cache pool</h2>
        <p className="desc">Music downloaded from any source lives in one pool shared by all users. Formats are transcoded on demand.</p>
        <div className="chip-row" style={{ marginBottom: 14 }}>
          <span className="chip"><DownloadIcon size={13} /> {status?.cache?.availableTracks ?? 0} tracks available</span>
          <span className="chip"><DownloadIcon size={13} /> {status?.cache?.downloading ?? 0} downloading</span>
          <span className="chip"><DownloadIcon size={13} /> original: {fmtBytes(status?.cache?.originalBytes)}</span>
          <span className="chip"><DownloadIcon size={13} /> transcoded: {fmtBytes(status?.cache?.transcodedBytes)}</span>
        </div>
        <button className="sp-btn sp-btn--ghost" onClick={refreshStatus}><RefreshIcon size={16} /> Refresh status</button>
      </div>
    </div>
  )
}
