import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'

import { useKV } from '@/hooks/use-kv'

type KVControls<T> = {
  value: T
  setValue: (next: T | ((prev: T) => T)) => void
  deleteValue: () => void
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
  const [value, setValue, deleteValue] = useKV<T>(storageKey, initialValue)

  useEffect(() => {
    onChange({ value, setValue, deleteValue })
  }, [value, setValue, deleteValue, onChange])

  return null
}

describe('useKV (local runtime)', () => {
  const key = 'u1_test_key'

  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('initializes from localStorage and does not hit Spark KV', async () => {
    localStorage.setItem(`birddex_kv_${key}`, JSON.stringify(['saved']))
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
      expect(localStorage.getItem(`birddex_kv_${key}`)).toBe(JSON.stringify(['a', 'b']))
    })

    act(() => {
      latest!.deleteValue()
    })
    await waitFor(() => {
      expect(localStorage.getItem(`birddex_kv_${key}`)).toBeNull()
      expect(latest?.value).toEqual([])
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
          key: `birddex_kv_${key}`,
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
          storageKey="test_key"
          initialValue={[]}
          onChange={() => {}}
        />,
      )
    }).toThrow('[useKV] Invalid key "test_key". Keys must be user-scoped (e.g. u123_photos).')
  })

  it('keeps user-scoped keys isolated from each other', async () => {
    localStorage.setItem('birddex_kv_u1_photos', JSON.stringify(['u1-photo']))
    localStorage.setItem('birddex_kv_u2_photos', JSON.stringify(['u2-photo']))

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
      expect(localStorage.getItem('birddex_kv_u1_photos')).toBe(JSON.stringify(['updated-u1']))
      expect(localStorage.getItem('birddex_kv_u2_photos')).toBe(JSON.stringify(['u2-photo']))
      expect(userTwo?.value).toEqual(['u2-photo'])
    })
  })
})
