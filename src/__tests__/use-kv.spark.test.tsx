/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url":"https://birddex--jlian.github.app/"}
 */

import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'

import { useKV } from '@/hooks/use-kv'

type KVControls<T> = {
  value: T
  setValue: (next: T | ((prev: T) => T)) => void
  deleteValue: () => void
  isLoading: boolean
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

describe('useKV (Spark runtime)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('does not repeatedly refetch Spark KV when rerendered with new [] literals', async () => {
    const key = 'u1_spark_existing'
    const keyUrlPart = `/${encodeURIComponent(key)}`

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'

      if (url.endsWith('/__probe__') && method === 'GET') {
        return new Response('', { status: 404 })
      }
      if (url.includes(keyUrlPart) && method === 'GET') {
        return new Response(JSON.stringify(['from-kv']), { status: 200 })
      }
      return new Response('', { status: 404 })
    })
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
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/__probe__'))).toBe(false)

    const getCallsAfterMount = fetchMock.mock.calls.filter(
      ([input, init]) => String(input).includes(keyUrlPart) && (init?.method ?? 'GET') === 'GET',
    ).length

    // New [] reference on rerender should not trigger another load-effect network cycle.
    rerender(<Harness storageKey={key} initialValue={[]} onChange={onChange} />)

    await waitFor(() => {
      expect(latest?.value).toEqual(['from-kv'])
      expect(latest?.isLoading).toBe(false)
    })

    const getCallsAfterRerender = fetchMock.mock.calls.filter(
      ([input, init]) => String(input).includes(keyUrlPart) && (init?.method ?? 'GET') === 'GET',
    ).length

    expect(getCallsAfterRerender).toBe(getCallsAfterMount)
  })

  it('seeds a missing Spark key once instead of posting repeatedly', async () => {
    const key = 'u1_spark_missing'
    const keyUrlPart = `/${encodeURIComponent(key)}`

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'

      if (url.endsWith('/__probe__') && method === 'GET') {
        return new Response('', { status: 404 })
      }
      if (url.includes(keyUrlPart) && method === 'GET') {
        return new Response('', { status: 404 })
      }
      if (url.includes(keyUrlPart) && method === 'POST') {
        return new Response('', { status: 200 })
      }
      return new Response('', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const onChange = vi.fn()
    const { rerender } = render(
      <Harness storageKey={key} initialValue={[]} onChange={onChange} />,
    )

    await waitFor(() => {
      const postCalls = fetchMock.mock.calls.filter(
        ([input, init]) => String(input).includes(keyUrlPart) && (init?.method ?? 'GET') === 'POST',
      )
      expect(postCalls.length).toBe(1)
    })
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/__probe__'))).toBe(false)

    rerender(<Harness storageKey={key} initialValue={[]} onChange={onChange} />)

    // Give effects a microtask; should still be one POST only.
    await waitFor(() => {
      const postCalls = fetchMock.mock.calls.filter(
        ([input, init]) => String(input).includes(keyUrlPart) && (init?.method ?? 'GET') === 'POST',
      )
      expect(postCalls.length).toBe(1)
    })
  })

  it('reports loading true until initial Spark read settles', async () => {
    const key = 'u1_spark_loading'
    const keyUrlPart = `/${encodeURIComponent(key)}`

    let resolveGet!: (value: Response) => void
    const pendingGet = new Promise<Response>((resolve) => {
      resolveGet = resolve
    })

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'

      if (url.includes(keyUrlPart) && method === 'GET') {
        return pendingGet
      }

      return Promise.resolve(new Response('', { status: 404 }))
    })
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
      expect(latest?.isLoading).toBe(true)
    })

    resolveGet(new Response(JSON.stringify(['loaded']), { status: 200 }))

    await waitFor(() => {
      expect(latest?.value).toEqual(['loaded'])
      expect(latest?.isLoading).toBe(false)
    })
  })
})
