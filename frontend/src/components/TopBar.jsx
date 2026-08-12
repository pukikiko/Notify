import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../store'
import { ArrowLeftIcon, ArrowRightIcon, SearchIcon, LogoutIcon, SettingsIcon } from '../icons'

function useNavStack() {
  const stack = useRef([])
  const pos = useRef(-1)

  const push = useCallback((hash) => {
    if (stack.current[pos.current] === hash) return
    stack.current = stack.current.slice(0, pos.current + 1)
    stack.current.push(hash)
    pos.current = stack.current.length - 1
  }, [])

  const back = useCallback(() => {
    if (pos.current > 0) {
      pos.current -= 1
      return stack.current[pos.current]
    }
    return null
  }, [])

  const forward = useCallback(() => {
    if (pos.current < stack.current.length - 1) {
      pos.current += 1
      return stack.current[pos.current]
    }
    return null
  }, [])

  return { push, back, forward }
}

export default function TopBar({ view, navigate }) {
  const { user, logout } = useApp()
  const { push, back, forward } = useNavStack()
  const [q, setQ] = useState('')
  const inputRef = useRef(null)
  const [focus, setFocus] = useState(false)

  useEffect(() => {
    const hash = window.location.hash
    push(hash)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [window.location.hash])

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
    setQ(params.get('q') || '')
  }, [view])

  const goBack = () => {
    const h = back()
    if (h) window.location.hash = h
  }
  const goForward = () => {
    const h = forward()
    if (h) window.location.hash = h
  }

  const onSearch = (val) => {
    setQ(val)
    navigate(`/search${val.trim() ? `?q=${encodeURIComponent(val)}` : ''}`)
  }

  return (
    <div className={`topbar ${!q.trim() && view !== '/search' ? 'topbar--flat' : ''}`}>
      <div className="topbar-arrows">
        <button onClick={goBack} title="Go back" aria-label="Go back"><ArrowLeftIcon size={18} /></button>
        <button onClick={goForward} title="Go forward" aria-label="Go forward"><ArrowRightIcon size={18} /></button>
      </div>

      <div className={`topbar-search ${focus ? 'focus' : ''}`}>
        <SearchIcon size={20} />
        <input
          ref={inputRef}
          placeholder="What do you want to play?"
          value={q}
          onChange={(e) => onSearch(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) navigate(`/search?q=${encodeURIComponent(q)}`) }}
        />
      </div>

      <div className="topbar-right">
        <button className="topbar-icon-btn" title="Settings" aria-label="Settings" onClick={() => navigate('/settings')}>
          <SettingsIcon size={20} />
        </button>
        <button className="topbar-user" title={`${user?.username} · Log out`} onClick={logout}>
          <span className="avatar">{(user?.username || 'U').slice(0, 1).toUpperCase()}</span>
          {user?.username}
          <LogoutIcon size={16} />
        </button>
      </div>
    </div>
  )
}
