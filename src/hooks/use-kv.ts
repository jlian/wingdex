import { useState, useCallback, useEffect, useSyncExternalStore } from 'react'

/**
 * KV hook for BirdDex.
 *
 * • Production (*.github.app) — uses Spark KV exclusively.
 * • Dev / Codespaces          — falls back to localStorage. A banner can be
 *   shown via `useIsLocalStorageMode()`.
 *
 * localStorage is **never** read or written when Spark KV is available.
 */

type SetValue<T> = (newValue: T | ((prev: T) => T)) => void

const LS_PREFIX = 'birddex_kv_'
const KV_BASE = '/_spark/kv'
const SPARK_KV_WRITE_RETRIES = 2

// ── Probe (singleton promise — runs at most once) ───────────────────────

let _probePromise: Promise<boolean> | null = null
let _sparkKvAvailable: boolean | null = null

/** Listeners for the external store that tracks localStorage-mode. */
const _modeListeners = new Set<() => void>()
function notifyModeListeners() {
  _modeListeners.forEach((l) => l())
}

function isSparkHostedRuntime(): boolean {
  if (typeof window === 'undefined') return false
  const host = window.location.hostname.toLowerCase()
  return host === 'github.app' || host.endsWith('.github.app')
}

function probeSparkKv(): Promise<boolean> {
  if (_probePromise) return _probePromise

  if (!isSparkHostedRuntime()) {
    _sparkKvAvailable = false
    _probePromise = Promise.resolve(false)
    notifyModeListeners()
    return _probePromise
  }

  _probePromise = (async () => {
    try {
      // GET a key that will never exist. 404 ⇒ KV is reachable.
      const res = await fetch(`${KV_BASE}/__probe__`, { method: 'GET' })
      _sparkKvAvailable = res.ok || res.status === 404
    } catch {
      _sparkKvAvailable = false
    }
    notifyModeListeners()
    return _sparkKvAvailable
  })()

  return _probePromise
}

// ── Hook: surface whether we're in localStorage-only mode ───────────────

/**
 * Returns `true` when the app is running in localStorage-only (dev) mode.
 * Returns `null` while the probe is still in-flight.
 */
export function useIsLocalStorageMode(): boolean | null {
  const mode = useSyncExternalStore(
    (cb) => {
      _modeListeners.add(cb)
      // Kick off the probe if it hasn't started yet
      void probeSparkKv()
      return () => { _modeListeners.delete(cb) }
    },
    () => _sparkKvAvailable,   // client snapshot
    () => null,                // server snapshot
  )
  // invert: _sparkKvAvailable === true → NOT localStorage mode
  if (mode === null) return null
  return !mode
}

// ── Spark KV helpers ────────────────────────────────────────────────────

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
  for (let attempt = 0; attempt <= SPARK_KV_WRITE_RETRIES; attempt++) {
    try {
      const res = await fetch(`${KV_BASE}/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(value),
      })
      if (res.ok) return true
    } catch { /* retry */ }
  }
  console.warn(`[useKV] Failed to persist "${key}" to Spark KV after retries.`)
  return false
}

async function sparkKvDelete(key: string): Promise<boolean> {
  for (let attempt = 0; attempt <= SPARK_KV_WRITE_RETRIES; attempt++) {
    try {
      const res = await fetch(`${KV_BASE}/${encodeURIComponent(key)}`, { method: 'DELETE' })
      if (res.ok) return true
    } catch { /* retry */ }
  }
  console.warn(`[useKV] Failed to delete "${key}" from Spark KV after retries.`)
  return false
}

// ── localStorage helpers (dev mode only) ────────────────────────────────

function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key)
    if (raw !== null) return JSON.parse(raw)
  } catch { /* ignore */ }
  return fallback
}

function lsSet<T>(key: string, value: T): void {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)) } catch { /* ignore */ }
}

function lsRemove(key: string): void {
  try { localStorage.removeItem(LS_PREFIX + key) } catch { /* ignore */ }
}

// ── Main hook ───────────────────────────────────────────────────────────

export function useKV<T>(key: string, initialValue: T): [T, SetValue<T>, () => void] {
  const [value, setValue] = useState<T>(initialValue)
  const [ready, setReady] = useState(false)

  // On mount: determine backend, load value from the right place
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const kvAvailable = await probeSparkKv()
      if (cancelled) return

      if (kvAvailable) {
        // ── Production: Spark KV is the sole source of truth ──
        const stored = await sparkKvGet<T>(key)
        if (cancelled) return
        if (stored !== undefined) {
          setValue(stored)
        } else {
          // Key doesn't exist yet — seed it with initialValue
          await sparkKvSet(key, initialValue)
          setValue(initialValue)
        }
      } else {
        // ── Dev mode: localStorage fallback ──
        setValue(lsGet(key, initialValue))
      }
      setReady(true)
    })()
    return () => { cancelled = true }
  }, [key, initialValue])

  // Cross-tab sync (dev mode only — localStorage)
  useEffect(() => {
    if (_sparkKvAvailable) return // KV mode — no localStorage sync
    const handler = (e: StorageEvent) => {
      if (e.key !== LS_PREFIX + key) return
      if (e.newValue === null) { setValue(initialValue); return }
      try { setValue(JSON.parse(e.newValue)) } catch { /* ignore */ }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [key, initialValue, ready])

  const userSetValue: SetValue<T> = useCallback((newValue) => {
    setValue((current) => {
      const next = typeof newValue === 'function'
        ? (newValue as (prev: T) => T)(current)
        : newValue

      if (_sparkKvAvailable) {
        void sparkKvSet(key, next)
      } else {
        lsSet(key, next)
      }
      return next
    })
  }, [key])

  const deleteValue = useCallback(() => {
    setValue(initialValue)
    if (_sparkKvAvailable) {
      void sparkKvDelete(key)
    } else {
      lsRemove(key)
    }
  }, [key, initialValue])

  return [value, userSetValue, deleteValue]
}
