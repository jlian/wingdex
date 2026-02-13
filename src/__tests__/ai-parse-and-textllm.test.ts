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

const { safeParseJSON, textLLM } = await import('@/lib/ai-inference')

// ── safeParseJSON ───────────────────────────────────────────

describe('safeParseJSON', () => {
  it('parses valid JSON directly', () => {
    const result = safeParseJSON('{"species":"Blue Jay","confidence":0.9}')
    expect(result).toEqual({ species: 'Blue Jay', confidence: 0.9 })
  })

  it('extracts JSON from markdown code block', () => {
    const text = 'Here is the result:\n```json\n{"candidates":[{"species":"Robin"}]}\n```'
    const result = safeParseJSON(text)
    expect(result).toEqual({ candidates: [{ species: 'Robin' }] })
  })

  it('extracts JSON from untagged code block', () => {
    const text = 'Result:\n```\n{"answer":"yes"}\n```'
    const result = safeParseJSON(text)
    expect(result).toEqual({ answer: 'yes' })
  })

  it('extracts JSON object embedded in prose', () => {
    const text = 'The bird is a {"species":"Cardinal","confidence":0.95} which is common here.'
    const result = safeParseJSON(text)
    expect(result).toEqual({ species: 'Cardinal', confidence: 0.95 })
  })

  it('returns null for completely unparseable text', () => {
    expect(safeParseJSON('I cannot identify the bird.')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(safeParseJSON('')).toBeNull()
  })

  it('handles nested JSON objects', () => {
    const text = '{"candidates":[{"species":"Hawk"}],"cropBox":{"x":10,"y":20,"width":50,"height":40}}'
    const result = safeParseJSON(text)
    expect(result.cropBox).toEqual({ x: 10, y: 20, width: 50, height: 40 })
  })

  it('handles JSON with whitespace in markdown block', () => {
    const text = '```json\n  {\n    "species": "Eagle"\n  }\n```'
    const result = safeParseJSON(text)
    expect(result).toEqual({ species: 'Eagle' })
  })
})

// ── textLLM ─────────────────────────────────────────────────

describe('textLLM', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('sends prompt to /_spark/llm and returns content', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Central Park, New York' } }],
      }),
    })

    const result = await textLLM('What location is at 40.78, -73.96?')
    expect(result).toBe('Central Park, New York')

    // Verify the request structure
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/_spark/llm')
    const body = JSON.parse(opts.body)
    expect(body.model).toBe('openai/gpt-4.1-mini')
    expect(body.messages[1].content).toContain('What location')
    expect(body.max_tokens).toBe(200)
    expect(body.temperature).toBe(0.3)
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
