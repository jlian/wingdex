/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url":"https://wingdex.app/"}
 */

import { render } from '@testing-library/react'
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

describe('useKV (hosted runtime)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('localStorage', createLocalStorageMock())
    if (typeof localStorage.clear === 'function') {
      localStorage.clear()
    }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not issue network calls when rerendered with new [] literals', async () => {
    const key = 'u1_hosted_existing'
    localStorage.setItem(`wingdex_kv_${key}`, JSON.stringify(['from-kv']))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    let latest: KVControls<string[]> | null = null
    const onChange = (controls: KVControls<string[]>) => {
      latest = controls
    }

    const { rerender } = render(
      <Harness storageKey={key} initialValue={[]} onChange={onChange} />,
    )

    await waitFor(() => {
      expect(latest?.value).toEqual(['from-kv'])
      expect(latest?.isLoading).toBe(false)
    })
    const callsAfterMount = fetchMock.mock.calls.length

    // New [] reference on rerender should not trigger another load-effect network cycle.
    rerender(<Harness storageKey={key} initialValue={[]} onChange={onChange} />)

    await waitFor(() => {
      expect(latest?.value).toEqual(['from-kv'])
      expect(latest?.isLoading).toBe(false)
    })

    const callsAfterRerender = fetchMock.mock.calls.length

    expect(callsAfterRerender).toBe(callsAfterMount)
  })

  it('keeps missing keys in-memory and remains stable on rerender', async () => {
    const key = 'u1_hosted_missing'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const onChange = vi.fn()
    const { rerender } = render(
      <Harness storageKey={key} initialValue={[]} onChange={onChange} />,
    )

    await waitFor(() => {
      expect(localStorage.getItem(`wingdex_kv_${key}`)).toBeNull()
    })
    expect(fetchMock).not.toHaveBeenCalled()

    rerender(<Harness storageKey={key} initialValue={[]} onChange={onChange} />)

    await waitFor(() => {
      expect(localStorage.getItem(`wingdex_kv_${key}`)).toBeNull()
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports loading false immediately in localStorage-only mode', async () => {
    const key = 'u1_hosted_loading'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

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
      expect(latest?.isLoading).toBe(false)
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
