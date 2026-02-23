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

  it('returns false when token is blank', async () => {
    globalThis.fetch = vi.fn()

    expect(await verifyTurnstile('   ', 'secret')).toBe(false)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('returns false when fetch rejects', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'))

    await expect(verifyTurnstile('token', 'secret')).resolves.toBe(false)
  })

  it('returns false when response JSON parsing throws', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new Error('bad json') },
    })

    await expect(verifyTurnstile('token', 'secret')).resolves.toBe(false)
  })

  it('returns false when hostname does not match expected hostname', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, hostname: 'wrong.example.com' }),
    })

    await expect(verifyTurnstile('token', 'secret', null, 'wingdex.app')).resolves.toBe(false)
  })

  it('accepts parent/child hostname match for preview subdomains', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, hostname: 'wingdex.pages.dev', action: 'anonymous_signin' }),
    })

    await expect(
      verifyTurnstile(
        'token',
        'secret',
        null,
        'feat-turnstile-anonymous-sig.wingdex.pages.dev',
        'anonymous_signin',
      ),
    ).resolves.toBe(true)
  })

  it('rejects unrelated hostname even when action matches', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, hostname: 'evil.example.com', action: 'anonymous_signin' }),
    })

    await expect(
      verifyTurnstile(
        'token',
        'secret',
        null,
        'feat-turnstile-anonymous-sig.wingdex.pages.dev',
        'anonymous_signin',
      ),
    ).resolves.toBe(false)
  })

  it('returns false when action does not match expected action', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, hostname: 'wingdex.app', action: 'signup' }),
    })

    await expect(
      verifyTurnstile('token', 'secret', null, 'wingdex.app', 'anonymous_signin'),
    ).resolves.toBe(false)
  })

  it('returns true when expected action is set but response action is missing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, hostname: 'wingdex.app' }),
    })

    await expect(
      verifyTurnstile('token', 'secret', null, 'wingdex.app', 'anonymous_signin'),
    ).resolves.toBe(true)
  })

  it('returns true when expected hostname and action both match', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, hostname: 'wingdex.app', action: 'anonymous_signin' }),
    })

    await expect(
      verifyTurnstile('token', 'secret', null, 'wingdex.app', 'anonymous_signin'),
    ).resolves.toBe(true)
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
