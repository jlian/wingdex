import { useState, useCallback, useEffect, useRef } from 'react'

type SetValue<T> = (newValue: T | ((prev: T) => T)) => void

const LS_PREFIX = 'wingdex_kv_'
const USER_SCOPED_KEY_PATTERN = /^[a-zA-Z0-9-]+_[a-zA-Z][a-zA-Z0-9_]*$/

function assertUserScopedKey(key: string): void {
  if (USER_SCOPED_KEY_PATTERN.test(key)) return
  throw new Error(
    `[useKV] Invalid key "${key}". Keys must be user-scoped (e.g. dev-user_photos or 550e8400-e29b-41d4-a716-446655440000_photos).`
  )
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

export function useKV<T>(key: string, initialValue: T): [T, SetValue<T>, () => void, boolean] {
  assertUserScopedKey(key)

  const initialValueRef = useRef(initialValue)
  const [value, setValue] = useState<T>(() => getLocalStorage(key, initialValue))
  const isLoading = false

  // Keep the latest fallback value without making network effects depend on
  // reference-unstable literals like [] passed from callers.
  useEffect(() => {
    initialValueRef.current = initialValue
  }, [key, initialValue])

  useEffect(() => {
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
  }, [key])

  const userSetValue: SetValue<T> = useCallback((newValue) => {
    setValue((currentValue) => {
      const nextValue = typeof newValue === 'function'
        ? (newValue as (prev: T) => T)(currentValue)
        : newValue

      setLocalStorage(key, nextValue)

      return nextValue
    })
  }, [key])

  const deleteValue = useCallback(() => {
    setValue(initialValueRef.current)
    try { localStorage.removeItem(LS_PREFIX + key) } catch { /* ignore */ }
  }, [key])

  return [value, userSetValue, deleteValue, isLoading]
}
