import { act, render } from '@testing-library/react'
import { waitFor } from '@testing-library/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'

import { useKV } from '@/hooks/use-kv'

type KVControls<T> = {
  value: T
  setValue: (next: T | ((prev: T) => T)) => void
  deleteValue: () => void
  isLoading: boolean
}

function createLocalStorageMock() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
  }
}

function clearStorageSafe() {
  if (typeof localStorage?.clear === 'function') {
    localStorage.clear()
  }
}

function Harness<T>({
  storageKey,
  initialValue,
  onChange,
}: {
  storageKey: string
  initialValue: T
  onChange: (controls: KVControls<T>) => void
}) {
  const [value, setValue, deleteValue, isLoading] = useKV<T>(storageKey, initialValue)

  useEffect(() => {
    onChange({ value, setValue, deleteValue, isLoading })
  }, [value, setValue, deleteValue, isLoading, onChange])

  return null
}

describe('useKV (local runtime)', () => {
  const key = 'u1_test_key'

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('localStorage', createLocalStorageMock())
    clearStorageSafe()
  })

  afterEach(() => {
    clearStorageSafe()
    vi.unstubAllGlobals()
  })

  it('initializes from localStorage and does not hit Spark KV', async () => {
    localStorage.setItem(`wingdex_kv_${key}`, JSON.stringify(['saved']))
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    let latest: KVControls<string[]> | null = null
    render(
      <Harness
        storageKey={key}
        initialValue={[]}
        onChange={(controls) => {
          latest = controls
        }}
      />,
    )

    await waitFor(() => {
      expect(latest?.value).toEqual(['saved'])
      expect(latest?.isLoading).toBe(false)
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('writes to and deletes from localStorage via setter and delete callback', async () => {
    let latest: KVControls<string[]> | null = null
    render(
      <Harness
        storageKey={key}
        initialValue={[]}
        onChange={(controls) => {
          latest = controls
        }}
      />,
    )

    await waitFor(() => {
      expect(latest).not.toBeNull()
    })

    act(() => {
      latest!.setValue(['a', 'b'])
    })
    await waitFor(() => {
      expect(localStorage.getItem(`wingdex_kv_${key}`)).toBe(JSON.stringify(['a', 'b']))
    })

    act(() => {
      latest!.deleteValue()
    })
    await waitFor(() => {
      expect(localStorage.getItem(`wingdex_kv_${key}`)).toBeNull()
      expect(latest?.value).toEqual([])
      expect(latest?.isLoading).toBe(false)
    })
  })

  it('reacts to storage events from other tabs in local mode', async () => {
    let latest: KVControls<string[]> | null = null
    render(
      <Harness
        storageKey={key}
        initialValue={[]}
        onChange={(controls) => {
          latest = controls
        }}
      />,
    )

    await waitFor(() => {
      expect(latest?.value).toEqual([])
    })

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: `wingdex_kv_${key}`,
          newValue: JSON.stringify(['sync']),
        }),
      )
    })

    await waitFor(() => {
      expect(latest?.value).toEqual(['sync'])
    })
  })

  it('throws for non user-scoped keys', () => {
    expect(() => {
      render(
        <Harness
          storageKey="testkey"
          initialValue={[]}
          onChange={() => {}}
        />,
      )
    }).toThrow('[useKV] Invalid key "testkey". Keys must be user-scoped (e.g. dev-user_photos or 550e8400-e29b-41d4-a716-446655440000_photos).')
  })

  it('keeps user-scoped keys isolated from each other', async () => {
    localStorage.setItem('wingdex_kv_u1_photos', JSON.stringify(['u1-photo']))
    localStorage.setItem('wingdex_kv_u2_photos', JSON.stringify(['u2-photo']))

    let userOne: KVControls<string[]> | null = null
    let userTwo: KVControls<string[]> | null = null

    render(
      <>
        <Harness
          storageKey="u1_photos"
          initialValue={[]}
          onChange={(controls) => {
            userOne = controls
          }}
        />
        <Harness
          storageKey="u2_photos"
          initialValue={[]}
          onChange={(controls) => {
            userTwo = controls
          }}
        />
      </>,
    )

    await waitFor(() => {
      expect(userOne?.value).toEqual(['u1-photo'])
      expect(userTwo?.value).toEqual(['u2-photo'])
    })

    act(() => {
      userOne!.setValue(['updated-u1'])
    })

    await waitFor(() => {
      expect(localStorage.getItem('wingdex_kv_u1_photos')).toBe(JSON.stringify(['updated-u1']))
      expect(localStorage.getItem('wingdex_kv_u2_photos')).toBe(JSON.stringify(['u2-photo']))
      expect(userTwo?.value).toEqual(['u2-photo'])
    })
  })
})
