import React, { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react'
import { api, streamUrl } from './api'

const PlayerCtx = createContext(null)
export const usePlayer = () => useContext(PlayerCtx)

/** A queue entry that is already a real library track (numeric id or has a
    streamUrl) vs. a discover placeholder that still needs /discover/play to
    be resolved (downloaded) before it can stream. */
const isResolved = (t) => t && (typeof t.id === 'number' || !!t.streamUrl)

const discoverPayload = (t) => ({
  kind: 'track',
  artist: t.artist?.name,
  album: t.album?.title,
  title: t.title,
  mbid: t.mbid,
  image: t.image,
  duration: t.duration,
  source: t.source
})

export function PlayerProvider({ children }) {
  const audioRef = useRef(null)
  const queueRef = useRef([])
  const indexRef = useRef(-1)
  const loadSeqRef = useRef(0)
  const prefetchingRef = useRef(new Set())
  const advanceRef = useRef(null)
  const [queue, setQueue] = useState([])
  const [index, setIndex] = useState(-1)
  const [current, setCurrent] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState('off')
  const [volume, setVolume] = useState(0.8)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
  }, [volume])

  const patchQueue = useCallback((fn) => {
    queueRef.current = fn(queueRef.current)
    setQueue(queueRef.current)
  }, [])

  const startPlay = useCallback((track) => {
    setPreparing(false)
    const audio = audioRef.current
    audio.src = streamUrl(track.id)
    audio.load()
    audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }, [])

  /** Keep the queue row in sync while the current track is still being
      downloaded in the background (live-streaming plays it early, but the
      row should still flip to "available" once the cache is complete). */
  useEffect(() => {
    if (!current || current.status !== 'downloading') return
    let stopped = false
    const poll = async () => {
      try {
        const { track: updated } = await api(`/library/tracks/${current.id}`)
        if (stopped || !updated) return
        if (updated.status === 'available') {
          patchQueue((qq) => qq.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)))
          setCurrent((c) => (c && c.id === updated.id ? { ...c, ...updated } : c))
        }
      } catch { /* transient — keep polling */ }
    }
    const timer = setInterval(poll, 3000)
    poll()
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [current && current.id, current && current.status, patchQueue])

  /** Ensure the next 1-2 queue entries are cached in the background: any
      discover placeholder gets resolved via /discover/play (which starts the
      server-side download). The resolved row replaces the placeholder, so the
      track is already downloaded (or downloading) by the time it's reached. */
  const prefetchNext = useCallback((fromIdx = indexRef.current, q = queueRef.current) => {
    for (let i = 1; i <= 2; i++) {
      const next = q[fromIdx + i]
      if (!next || isResolved(next)) continue
      if (prefetchingRef.current.has(next.id)) continue
      prefetchingRef.current.add(next.id)
      api('/discover/play', { method: 'POST', body: discoverPayload(next) })
        .then(({ tracks }) => {
          const row = tracks && tracks[0]
          if (row) {
            patchQueue((qq) => qq.map((t, j) => (j === fromIdx + i ? row : t)))
          }
        })
        .catch(() => { /* unresolvable — the player will skip it on reach */ })
        .finally(() => prefetchingRef.current.delete(next.id))
    }
  }, [patchQueue])

  /** Make queue entry idx playable: resolved+available plays now, a
      downloading track is streamed in real time as it downloads (the server
      feeds the growing source through the transcoder straight to us), and
      discover placeholders are first resolved through the server. Returns
      'played' | 'failed' | 'gone'. */
  const playEntry = useCallback(async (idx, seq) => {
    const track = queueRef.current[idx]
    if (!track) return 'gone'
    if (isResolved(track)) {
      if (track.status === 'available' || track.status === 'downloading') {
        startPlay(track)
        prefetchNext(idx)
        return 'played'
      }
      return 'failed'
    }
    setPreparing(true)
    try {
      const { tracks: rows } = await api('/discover/play', { method: 'POST', body: discoverPayload(track) })
      if (idx !== indexRef.current || seq !== loadSeqRef.current) return 'gone'
      const row = rows && rows[0]
      if (!row) { setPreparing(false); return 'failed' }
      patchQueue((qq) => qq.map((t, i) => (i === idx ? row : t)))
      setCurrent(row)
      if (row.status === 'available' || row.status === 'downloading') {
        startPlay(row)
        prefetchNext(idx)
        return 'played'
      }
      setPreparing(false)
      return 'failed'
    } catch (err) {
      if (idx !== indexRef.current || seq !== loadSeqRef.current) return 'gone'
      setPreparing(false)
      return 'failed'
    }
  }, [patchQueue, startPlay, prefetchNext])

  const loadIndex = useCallback(async (idx, q = queueRef.current) => {
    const track = q[idx]
    if (!track) return
    const seq = ++loadSeqRef.current
    indexRef.current = idx
    queueRef.current = q
    setIndex(idx)
    setCurrent(track)
    setPreparing(false)
    setPosition(0)
    const audio = audioRef.current
    audio.pause()
    try { audio.removeAttribute('src') } catch { /* ignore */ }
    audio.load()
    const result = await playEntry(idx, seq)
    // A track that can't be found/downloaded is skipped, Spotify-style.
    if (result === 'failed' && idx === indexRef.current && seq === loadSeqRef.current) {
      advanceRef.current?.(1)
    }
  }, [playEntry])

  const advance = useCallback(async (delta) => {
    const audio = audioRef.current
    const q = queueRef.current
    const i = indexRef.current
    if (repeat === 'one' && delta === 1) {
      audio.currentTime = 0
      audio.play()
      return
    }
    let nextIdx
    const n = q.length
    if (shuffle && delta > 0) {
      nextIdx = Math.floor(Math.random() * n)
      if (nextIdx === i && n > 1) nextIdx = (nextIdx + 1) % n
    } else {
      nextIdx = i + delta
    }
    if (nextIdx >= n) {
      if (repeat === 'all') {
        nextIdx = 0
      } else {
        setPlaying(false)
        return
      }
    }
    if (nextIdx < 0) nextIdx = n - 1
    loadIndex(nextIdx)
  }, [shuffle, repeat, loadIndex])

  advanceRef.current = advance

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onEnded = () => advance(1)
    const onTime = () => {
      setPosition(audio.currentTime)
      setDuration(audio.duration || 0)
    }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    return () => {
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
    }
  }, [advance])

  const playQueue = useCallback((tracks, startIndex = 0, opts = {}) => {
    if (!tracks.length) return
    const q = [...tracks]
    let start = startIndex
    if (opts.startId) {
      const found = q.findIndex((t) => t.id === opts.startId)
      if (found >= 0) start = found
    }
    // Spotify-style: a queue starts at the clicked song — everything before it
    // is dropped, so playing track 5 of an album queues tracks 5..N, not 1..N.
    const trimmed = q.slice(start)
    prefetchingRef.current.clear()
    queueRef.current = trimmed
    setQueue(trimmed)
    loadIndex(0, trimmed)
  }, [loadIndex])

  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (!current) return
    if (audio.paused) audio.play().catch(() => {})
    else audio.pause()
  }, [current])

  const seek = useCallback((t) => {
    if (audioRef.current) audioRef.current.currentTime = t
  }, [])

  const value = {
    queue, index, current, playing, preparing,
    shuffle, setShuffle, repeat, setRepeat,
    volume, setVolume, position, duration,
    playQueue, toggle, seek, advance, loadIndex
  }

  return (
    <PlayerCtx.Provider value={value}>
      <audio ref={audioRef} preload="auto" />
      {children}
    </PlayerCtx.Provider>
  )
}
