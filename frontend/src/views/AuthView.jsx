import React, { useState } from 'react'
import { useApp } from '../store'

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

  const switchMode = () => {
    setMode(mode === 'login' ? 'register' : 'login')
    setError('')
  }

  return (
    <div className="auth-page">
      <header className="auth-header">
        <a href="#/" className="auth-brand" onClick={(e) => e.preventDefault()}>
          <span>Notify</span>
        </a>
      </header>

      <main className="auth-main">
        <form className="auth-card" onSubmit={submit} noValidate>
          <h1>{mode === 'login' ? 'Log in to Notify' : 'Sign up for Notify'}</h1>

          <label className="auth-field">
            <span>Username</span>
            <input
              id="username"
              name="username"
              type="text"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </label>

          <label className="auth-field">
            <span>Password</span>
            <input
              id="password"
              name="password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>

          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="auth-submit" disabled={busy}>
            {busy ? (mode === 'login' ? 'Logging in…' : 'Signing up…') : mode === 'login' ? 'Log In' : 'Sign Up'}
          </button>

          <div className="auth-or"><span>or</span></div>

          <p className="auth-alt">{mode === 'login' ? "Don't have an account?" : 'Already have an account?'}</p>
          <button type="button" className="auth-switch-btn" onClick={switchMode}>
            {mode === 'login' ? 'Sign up for Notify' : 'Log in'}
          </button>
        </form>
      </main>

      <footer className="auth-footer">
        Your private music. Pulled from Soulseek, cached and streamed for your accounts.
      </footer>
    </div>
  )
}
