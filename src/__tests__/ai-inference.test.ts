import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock fetch globally before importing the module
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock HTMLImageElement loading
vi.stubGlobal('Image', class {
  width = 100
  height = 100
  onload: (() => void) | null = null
  onerror: ((e: any) => void) | null = null
  set src(_: string) {
    setTimeout(() => this.onload?.(), 0)
  }
})

// Mock canvas for compressImage
const mockCanvasCtx = {
  drawImage: vi.fn(),
}
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockCanvasCtx) as any
HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,mock')

// Now import after mocks are in place
const { identifyBirdInPhoto } = await import('@/lib/ai-inference')

function mockLLMResponse(json: any) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(json) } }],
    }),
    text: async () => JSON.stringify(json),
  })
}

function mockLLMError(status: number, body: string) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: async () => body,
  })
}

describe('identifyBirdInPhoto', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('parses candidates from LLM response', async () => {
    mockLLMResponse({
      candidates: [
        { species: 'Northern Cardinal (Cardinalis cardinalis)', confidence: 0.92 },
        { species: 'Pyrrhuloxia (Cardinalis sinuatus)', confidence: 0.45 },
      ],
      cropBox: { x: 20, y: 30, width: 40, height: 35 },
    })

    const result = await identifyBirdInPhoto('data:image/jpeg;base64,test')

    expect(result.candidates).toHaveLength(2)
    // Should be grounded to canonical eBird names with scientific names
    expect(result.candidates[0].species).toBe('Northern Cardinal (Cardinalis cardinalis)')
    expect(result.candidates[0].confidence).toBe(0.92)
    expect(result.candidates[1].species).toBe('Pyrrhuloxia (Cardinalis sinuatus)')
    expect(result.cropBox).toEqual({ x: 20, y: 30, width: 40, height: 40 })
  })

  it('sorts candidates by confidence descending', async () => {
    mockLLMResponse({
      candidates: [
        { species: 'Grey Heron', confidence: 0.74 },
        { species: 'Great Blue Heron', confidence: 0.89 },
        { species: 'Great Egret', confidence: 0.42 },
      ],
      cropBox: null,
    })

    const result = await identifyBirdInPhoto(
      'data:image/jpeg;base64,test',
      { lat: 47.6062, lon: -122.3321 },
      6,
      'Seattle, Washington, USA'
    )

    expect(result.candidates).toHaveLength(3)
    expect(result.candidates.map(c => c.confidence)).toEqual([0.89, 0.74, 0.42])
    expect(result.candidates[0].species).toBe('Great Blue Heron (Ardea herodias)')
  })

  it('grounds AI species names to canonical taxonomy', async () => {
    mockLLMResponse({
      candidates: [
        { species: 'Common Kingfisher (Alcedo atthis)', confidence: 0.95 },
      ],
      cropBox: null,
    })

    const result = await identifyBirdInPhoto('data:image/jpeg;base64,test')

    // "Common Kingfisher (Alcedo atthis)" should be normalized to canonical format with scientific name
    expect(result.candidates[0].species).toBe('Common Kingfisher (Alcedo atthis)')
  })

  it('filters out low-confidence candidates (below 0.3)', async () => {
    mockLLMResponse({
      candidates: [
        { species: 'Blue Jay', confidence: 0.88 },
        { species: 'Steller\'s Jay', confidence: 0.15 },
      ],
      cropBox: null,
    })

    const result = await identifyBirdInPhoto('data:image/jpeg;base64,test')

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].species).toBe('Blue Jay (Cyanocitta cristata)')
  })

  it('returns empty candidates when LLM finds no bird', async () => {
    mockLLMResponse({
      candidates: [],
      cropBox: null,
    })

    const result = await identifyBirdInPhoto('data:image/jpeg;base64,test')

    expect(result.candidates).toHaveLength(0)
    expect(result.cropBox).toBeUndefined()
  })

  it('throws informative error when JSON parse fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'I cannot identify this bird.' } }],
      }),
      text: async () => 'I cannot identify this bird.',
    })

    await expect(
      identifyBirdInPhoto('data:image/jpeg;base64,test')
    ).rejects.toThrow('unparseable response')
  })

  it('rejects invalid cropBox dimensions', async () => {
    mockLLMResponse({
      candidates: [{ species: 'Bald Eagle', confidence: 0.9 }],
      cropBox: { x: 10, y: 10, width: 3, height: 3 }, // too small (< 5)
    })

    const result = await identifyBirdInPhoto('data:image/jpeg;base64,test')

    expect(result.candidates).toHaveLength(1)
    expect(result.cropBox).toBeUndefined()
  })

  it('limits to 5 candidates max', async () => {
    mockLLMResponse({
      candidates: [
        { species: 'Species A', confidence: 0.9 },
        { species: 'Species B', confidence: 0.85 },
        { species: 'Species C', confidence: 0.8 },
        { species: 'Species D', confidence: 0.7 },
        { species: 'Species E', confidence: 0.6 },
        { species: 'Species F', confidence: 0.5 },
        { species: 'Species G', confidence: 0.4 },
      ],
      cropBox: null,
    })

    const result = await identifyBirdInPhoto('data:image/jpeg;base64,test')

    expect(result.candidates.length).toBeLessThanOrEqual(5)
  })

  it('throws informative error on 429 rate limit', async () => {
    // All 3 retry attempts return 429
    mockLLMError(429, 'Too Many Requests')
    mockLLMError(429, 'Too Many Requests')
    mockLLMError(429, 'Too Many Requests')

    await expect(
      identifyBirdInPhoto('data:image/jpeg;base64,test')
    ).rejects.toThrow('AI rate limit reached')
  })

  it('throws informative error on 413 too large', async () => {
    mockLLMError(413, 'Payload too large')

    await expect(
      identifyBirdInPhoto('data:image/jpeg;base64,test')
    ).rejects.toThrow('Image too large')
  })

  it('passes GPS context to the LLM prompt', async () => {
    mockLLMResponse({
      candidates: [{ species: 'Bald Eagle', confidence: 0.9 }],
      cropBox: null,
    })

    await identifyBirdInPhoto(
      'data:image/jpeg;base64,test',
      { lat: 40.7128, lon: -74.006 },
      5 // June
    )

    // Check that fetch was called with a body containing the GPS coords
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    const userContent = callBody.messages[1].content
    // Vision calls use content parts array
    const textPart = Array.isArray(userContent)
      ? userContent.find((p: any) => p.type === 'text')?.text
      : userContent
    expect(textPart).toContain('40.7128')
    expect(textPart).toContain('Jun')
  })

  it('passes location name context to the LLM prompt', async () => {
    mockLLMResponse({
      candidates: [{ species: 'Eastern Cattle-Egret', confidence: 0.9 }],
      cropBox: null,
    })

    await identifyBirdInPhoto(
      'data:image/jpeg;base64,test',
      { lat: 25.0306, lon: 121.5354 },
      11, // December
      "Da'an District, Taipei, Taiwan"
    )

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    const userContent = callBody.messages[1].content
    const textPart = Array.isArray(userContent)
      ? userContent.find((p: any) => p.type === 'text')?.text
      : userContent
    expect(textPart).toContain("Da'an District, Taipei, Taiwan")
    expect(textPart).toContain('25.0306')
    expect(textPart).toContain('Dec')
    expect(textPart).toContain('geographic range')
  })
})
