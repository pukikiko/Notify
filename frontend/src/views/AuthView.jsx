import React, { useState } from 'react'
import { useApp } from '../store'
import { NotifyLogo } from '../icons'

export default function AuthView() {
  const { login, register } = useApp()
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'login') await login(username, password)
      else await register(username, password)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app" style={{ justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', padding: '0 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <NotifyLogo size={52} />
        </div>

        <form className="form-card" onSubmit={submit} style={{ maxWidth: 432, background: '#121212', borderRadius: 8, padding: '0 32px 32px' }}>
          <h1>{mode === 'login' ? 'Log in to Notify' : 'Sign up for Notify'}</h1>
          <p className="form-sub">Your private music. Pulled from Soulseek, cached and streamed for your accounts.</p>

          <div className="divider-line" />
          <div className="divider-line" style={{ margin: '0 0 24px' }} />

          <label className="field">
            <label htmlFor="username">Username</label>
            <input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
          </label>
          <label className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </label>
          {error && <div className="error">{error}</div>}

          <button className="sp-btn sp-btn--primary" style={{ width: '100%', justifyContent: 'center', padding: '14px 32px' }} disabled={busy}>
            {busy ? '…' : mode === 'login' ? 'Log In' : 'Sign Up'}
          </button>
        </form>

        <div className="auth-switch" style={{ maxWidth: 432, margin: '0 auto' }}>
          <span>{mode === 'login' ? "Don't have an account?" : 'Already have an account?'}</span>{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); setMode(mode === 'login' ? 'register' : 'login') }}>
            {mode === 'login' ? 'Sign up for Notify' : 'Log in'}
          </a>
        </div>
      </div>
    </div>
  )
}
