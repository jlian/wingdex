import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { verifyTurnstile } from '../../functions/lib/turnstile'

describe('verifyTurnstile', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('returns true when siteverify responds with success', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    })

    const result = await verifyTurnstile('valid-token', 'secret-key')
    expect(result).toBe(true)

    expect(globalThis.fetch).toHaveBeenCalledOnce()
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    expect(init.method).toBe('POST')

    const body = new URLSearchParams(init.body)
    expect(body.get('secret')).toBe('secret-key')
    expect(body.get('response')).toBe('valid-token')
    expect(body.has('remoteip')).toBe(false)
  })

  it('sends remoteip when provided', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    })

    await verifyTurnstile('token', 'secret', '1.2.3.4')

    const body = new URLSearchParams((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
    expect(body.get('remoteip')).toBe('1.2.3.4')
  })

  it('returns false when siteverify responds with failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
    })

    expect(await verifyTurnstile('bad-token', 'secret')).toBe(false)
  })

  it('returns false when fetch fails (non-ok status)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    })

    expect(await verifyTurnstile('token', 'secret')).toBe(false)
  })

  it('does not include remoteip when null', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    })

    await verifyTurnstile('token', 'secret', null)

    const body = new URLSearchParams((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
    expect(body.has('remoteip')).toBe(false)
  })
})
