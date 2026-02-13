import { useState, useCallback, useEffect, useRef } from 'react'

/**
 * Runtime split:
 * - Spark-hosted (*.github.app): Spark KV only
 * - Non-Spark (local/codespaces): localStorage only
 */

type SetValue<T> = (newValue: T | ((prev: T) => T)) => void

const LS_PREFIX = 'birddex_kv_'
const KV_BASE = '/_spark/kv'
const SPARK_KV_PROBE_TTL_MS = 30_000
const SPARK_KV_WRITE_RETRIES = 2
const USER_SCOPED_KEY_PATTERN = /^u\d+_[a-zA-Z][a-zA-Z0-9_]*$/

function assertUserScopedKey(key: string): void {
  if (USER_SCOPED_KEY_PATTERN.test(key)) return
  throw new Error(
    `[useKV] Invalid key "${key}". Keys must be user-scoped (e.g. u123_photos).`
  )
}

function isSparkHostedRuntime(): boolean {
  if (typeof window === 'undefined') return false
  const host = window.location.hostname.toLowerCase()
  return host === 'github.app' || host.endsWith('.github.app')
}

// Cached after first probe so we only check once
let _sparkKvAvailable: boolean | null = null
let _sparkKvCheckedAt = 0

async function probeSparkKv(): Promise<boolean> {
  if (!isSparkHostedRuntime()) {
    _sparkKvAvailable = false
    _sparkKvCheckedAt = Date.now()
    return false
  }

  const isFresh = Date.now() - _sparkKvCheckedAt < SPARK_KV_PROBE_TTL_MS
  if (_sparkKvAvailable !== null && isFresh) return _sparkKvAvailable
  try {
    // Probe by GETting a specific key. The listing endpoint (/_spark/kv)
    // isn't supported by the production runtime. A 404 on a single key
    // means "key not found" which still proves KV is reachable.
    const res = await fetch(`${KV_BASE}/__probe__`, { method: 'GET' })
    _sparkKvAvailable = res.ok || res.status === 404
    _sparkKvCheckedAt = Date.now()
  } catch {
    _sparkKvAvailable = false
    _sparkKvCheckedAt = Date.now()
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

async function sparkKvSet<T>(key: string, value: T): Promise<boolean> {
  let ok = false
  for (let attempt = 0; attempt <= SPARK_KV_WRITE_RETRIES; attempt++) {
    try {
      const res = await fetch(`${KV_BASE}/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(value),
      })
      if (res.ok) {
        ok = true
        break
      }
    } catch { /* ignore and retry */ }
  }

  if (!ok) {
    console.warn(`[useKV] Failed to persist key "${key}" to Spark KV after retries; localStorage remains source of truth for this session.`)
  }

  return ok
}

async function sparkKvDelete(key: string): Promise<boolean> {
  let ok = false
  for (let attempt = 0; attempt <= SPARK_KV_WRITE_RETRIES; attempt++) {
    try {
      const res = await fetch(`${KV_BASE}/${encodeURIComponent(key)}`, { method: 'DELETE' })
      if (res.ok) {
        ok = true
        break
      }
    } catch { /* ignore and retry */ }
  }

  if (!ok) {
    console.warn(`[useKV] Failed to delete key "${key}" from Spark KV after retries.`)
  }

  return ok
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
  assertUserScopedKey(key)

  const sparkRuntime = isSparkHostedRuntime()
  const initialValueRef = useRef(initialValue)
  const [value, setValue] = useState<T>(() => (
    sparkRuntime ? initialValue : getLocalStorage(key, initialValue)
  ))
  const useSparkKv = useRef(false)

  // Keep the latest fallback value without making network effects depend on
  // reference-unstable literals like [] passed from callers.
  useEffect(() => {
    initialValueRef.current = initialValue
  }, [key, initialValue])

  // Spark runtime: load from Spark KV only.
  useEffect(() => {
    if (!sparkRuntime) {
      useSparkKv.current = false
      return
    }

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
        } else {
          await sparkKvSet(key, initialValueRef.current)
          setValue(initialValueRef.current)
        }
      } else {
        console.warn(`[useKV] Spark KV unavailable in Spark runtime for key "${key}".`)
      }
    })()
    return () => { cancelled = true }
  }, [key, sparkRuntime])

  // Non-Spark runtime: sync localStorage across tabs.
  useEffect(() => {
    if (sparkRuntime) return

    const handler = (e: StorageEvent) => {
      if (e.key !== LS_PREFIX + key) return
      if (e.newValue === null) {
        setValue(initialValueRef.current)
        return
      }
      try { setValue(JSON.parse(e.newValue)) } catch { /* ignore */ }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [key, sparkRuntime])

  const userSetValue: SetValue<T> = useCallback((newValue) => {
    setValue((currentValue) => {
      const nextValue = typeof newValue === 'function'
        ? (newValue as (prev: T) => T)(currentValue)
        : newValue

      if (sparkRuntime) {
        if (useSparkKv.current) {
          void sparkKvSet(key, nextValue)
        }
      } else {
        setLocalStorage(key, nextValue)
      }

      return nextValue
    })
  }, [key, sparkRuntime])

  const deleteValue = useCallback(() => {
    setValue(initialValueRef.current)
    if (sparkRuntime) {
      if (useSparkKv.current) {
        void sparkKvDelete(key)
      }
    } else {
      try { localStorage.removeItem(LS_PREFIX + key) } catch { /* ignore */ }
    }
  }, [key, sparkRuntime])

  return [value, userSetValue, deleteValue]
}
