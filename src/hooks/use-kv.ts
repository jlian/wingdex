import { useState, useCallback, useEffect, useRef } from 'react'

/**
 * Drop-in replacement for @github/spark's useKV hook.
 * Tries Spark KV first (works at birddex--jlian.github.app), falls back to
 * localStorage when Spark KV is unavailable (e.g. regular codespaces).
 */

type SetValue<T> = (newValue: T | ((prev: T) => T)) => void

const LS_PREFIX = 'birddex_kv_'
const KV_BASE = '/_spark/kv'

// Cached after first probe so we only check once
let _sparkKvAvailable: boolean | null = null

async function probeSparkKv(): Promise<boolean> {
  if (_sparkKvAvailable !== null) return _sparkKvAvailable
  try {
    const res = await fetch(`${KV_BASE}/keys`, { method: 'GET' })
    _sparkKvAvailable = res.ok
  } catch {
    _sparkKvAvailable = false
  }
  return _sparkKvAvailable
}

async function sparkKvGet<T>(key: string): Promise<T | undefined> {
  try {
    const res = await fetch(`${KV_BASE}/${encodeURIComponent(key)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'text/plain' },
    })
    if (!res.ok) return undefined
    return JSON.parse(await res.text())
  } catch { return undefined }
}

async function sparkKvSet<T>(key: string, value: T): Promise<void> {
  try {
    await fetch(`${KV_BASE}/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(value),
    })
  } catch { /* ignore */ }
}

async function sparkKvDelete(key: string): Promise<void> {
  try {
    await fetch(`${KV_BASE}/${encodeURIComponent(key)}`, { method: 'DELETE' })
  } catch { /* ignore */ }
}

function getLocalStorage<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(LS_PREFIX + key)
    if (stored !== null) return JSON.parse(stored)
  } catch { /* ignore */ }
  return fallback
}

function setLocalStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value))
  } catch { /* ignore */ }
}

export function useKV<T>(key: string, initialValue: T): [T, SetValue<T>, () => void] {
  const [value, setValue] = useState<T>(() => getLocalStorage(key, initialValue))
  const useSparkKv = useRef(false)

  // On mount: probe Spark KV, load from it if available
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const available = await probeSparkKv()
      if (cancelled) return
      useSparkKv.current = available
      if (available) {
        const stored = await sparkKvGet<T>(key)
        if (cancelled) return
        if (stored !== undefined) {
          setValue(stored)
          setLocalStorage(key, stored) // sync to localStorage as backup
        } else {
          // Key doesn't exist in Spark KV yet — seed it
          await sparkKvSet(key, getLocalStorage(key, initialValue))
        }
      }
    })()
    return () => { cancelled = true }
  }, [key])

  // Sync across tabs via storage event (localStorage only)
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === LS_PREFIX + key && e.newValue !== null) {
        try { setValue(JSON.parse(e.newValue)) } catch { /* ignore */ }
      }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [key])

  const userSetValue: SetValue<T> = useCallback((newValue) => {
    setValue((currentValue) => {
      const nextValue = typeof newValue === 'function'
        ? (newValue as (prev: T) => T)(currentValue)
        : newValue
      setLocalStorage(key, nextValue)
      if (useSparkKv.current) sparkKvSet(key, nextValue)
      return nextValue
    })
  }, [key])

  const deleteValue = useCallback(() => {
    setValue(initialValue)
    try { localStorage.removeItem(LS_PREFIX + key) } catch { /* ignore */ }
    if (useSparkKv.current) sparkKvDelete(key)
  }, [key, initialValue])

  return [value, userSetValue, deleteValue]
}
