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
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('initializes from localStorage and does not hit Spark KV', async () => {
    localStorage.setItem('birddex_kv_test_key', JSON.stringify(['saved']))
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    let latest: KVControls<string[]> | null = null
    render(
      <Harness
        storageKey="test_key"
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
        storageKey="test_key"
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
      expect(localStorage.getItem('birddex_kv_test_key')).toBe(JSON.stringify(['a', 'b']))
    })

    act(() => {
      latest!.deleteValue()
    })
    await waitFor(() => {
      expect(localStorage.getItem('birddex_kv_test_key')).toBeNull()
      expect(latest?.value).toEqual([])
    })
  })

  it('reacts to storage events from other tabs in local mode', async () => {
    let latest: KVControls<string[]> | null = null
    render(
      <Harness
        storageKey="test_key"
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
          key: 'birddex_kv_test_key',
          newValue: JSON.stringify(['sync']),
        }),
      )
    })

    await waitFor(() => {
      expect(latest?.value).toEqual(['sync'])
    })
  })
})
