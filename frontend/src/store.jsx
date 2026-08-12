import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { api, getToken, setToken } from './api'

const AppCtx = createContext(null)

export const useApp = () => useContext(AppCtx)

export function AppProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState(null)

  const refreshUser = useCallback(async () => {
    if (!getToken()) {
      setUser(null)
      setLoading(false)
      return
    }
    try {
      const { user } = await api('/auth/me')
      setUser(user)
    } catch {
      setToken(null)
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      const s = await api('/status')
      setStatus(s)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    refreshUser()
  }, [refreshUser])

  useEffect(() => {
    if (!user) return
    refreshStatus()
    const t = setInterval(refreshStatus, 15000)
    return () => clearInterval(t)
  }, [user, refreshStatus])

  const login = useCallback(async (username, password) => {
    const res = await api('/auth/login', { method: 'POST', body: { username, password } })
    setToken(res.token)
    setUser(res.user)
    return res.user
  }, [])

  const register = useCallback(async (username, password) => {
    const res = await api('/auth/register', { method: 'POST', body: { username, password } })
    setToken(res.token)
    setUser(res.user)
    return res.user
  }, [])

  const logout = useCallback(async () => {
    try { await api('/auth/logout', { method: 'POST' }) } catch { /* ignore */ }
    setToken(null)
    setUser(null)
  }, [])

  const updateSettings = useCallback(async (patch) => {
    const { settings } = await api('/auth/settings', { method: 'PUT', body: patch })
    setUser((u) => (u ? { ...u, settings } : u))
    return settings
  }, [])

  return (
    <AppCtx.Provider value={{ user, status, loading, login, register, logout, updateSettings, refreshStatus }}>
      {children}
    </AppCtx.Provider>
  )
}
