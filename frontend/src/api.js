import { useCallback, useEffect, useRef, useState } from 'react'

const BASE = import.meta.env.VITE_API_URL || ''

export class ApiError extends Error {
  constructor(status, detail) {
    super(detail?.message || 'Something went wrong')
    this.status = status
    this.detail = detail || {}
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  let res
  try {
    res = await fetch(BASE + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, { code: 'NETWORK', message: 'Cannot reach the server. Is the backend running?' })
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.detail)
  return data
}

export const imgUrl = (p) => (p ? BASE + p : '')

/** Fetch + optional polling (real-time updates). */
export function useApi(path, { poll = 0, deps = [] } = {}) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const alive = useRef(true)
  const load = useCallback(async () => {
    try {
      const d = await api(path)
      if (alive.current) { setData(d); setError(null) }
    } catch (e) {
      if (alive.current) setError(e)
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [path])
  useEffect(() => {
    alive.current = true
    setLoading(true)
    load()
    const t = poll ? setInterval(load, poll) : null
    return () => { alive.current = false; if (t) clearInterval(t) }
  }, [load, poll, ...deps])
  return { data, error, loading, reload: load }
}

export const rupee = (n) => `₹${Number(n).toLocaleString('en-IN')}`
