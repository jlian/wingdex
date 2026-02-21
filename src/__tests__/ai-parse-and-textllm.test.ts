import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock Image + Canvas for the module-level imports in ai-inference
vi.stubGlobal('Image', class {
  width = 100; height = 100
  onload: (() => void) | null = null
  set src(_: string) { setTimeout(() => this.onload?.(), 0) }
})
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({ drawImage: vi.fn() }) as any
HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,mock')

const { textLLM } = await import('@/lib/ai-inference')

// ── textLLM ─────────────────────────────────────────────────

describe('textLLM', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('sends prompt to /api/suggest-location and returns content', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: 'Central Park, New York' }),
    })

    const result = await textLLM('What location is at 40.78, -73.96?')
    expect(result).toBe('Central Park, New York')

    // Verify the request structure
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/suggest-location')
    const body = JSON.parse(opts.body)
    expect(body.prompt).toContain('What location')
  })

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    })

    await expect(textLLM('test')).rejects.toThrow('LLM 500')
  })

  it('throws on 429 rate limit', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'Too Many Requests',
    })

    await expect(textLLM('test')).rejects.toThrow('LLM 429')
  })
})
