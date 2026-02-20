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
      birdCenter: [40, 48],
    })

    const result = await identifyBirdInPhoto('data:image/jpeg;base64,test')

    expect(result.candidates).toHaveLength(2)
    // Should be grounded to canonical eBird names with scientific names
    expect(result.candidates[0].species).toBe('Northern Cardinal (Cardinalis cardinalis)')
    expect(result.candidates[0].confidence).toBe(0.92)
    expect(result.candidates[1].species).toBe('Pyrrhuloxia (Cardinalis sinuatus)')
    // Center (40,48) → 40% crop → x=20, y=28, w=40, h=40
    expect(result.cropBox).toEqual({ x: 20, y: 28, width: 40, height: 40 })
    expect(result.multipleBirds).toBe(false)
  })

  it('reports multipleBirds when LLM flags it', async () => {
    mockLLMResponse({
      candidates: [
        { species: 'Glaucous-winged Gull', confidence: 0.85 },
        { species: 'Common Goldeneye', confidence: 0.55 },
      ],
      birdCenter: [50, 50],
      multipleBirds: true,
    })

    const result = await identifyBirdInPhoto('data:image/jpeg;base64,test')

    expect(result.multipleBirds).toBe(true)
    expect(result.candidates.length).toBeGreaterThan(0)
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
    expect(result.candidates[0].species).toBe('Great Blue Heron')
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
    expect(result.candidates[0].species).toBe('Blue Jay')
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

  it('rejects missing birdCenter', async () => {
    mockLLMResponse({
      candidates: [{ species: 'Bald Eagle', confidence: 0.9 }],
      birdCenter: null,
    })

    const result = await identifyBirdInPhoto('data:image/jpeg;base64,test')

    expect(result.candidates).toHaveLength(1)
    expect(result.cropBox).toBeUndefined()
  })

  it('clamps crop box when bird center is near edge', async () => {
    mockLLMResponse({
      candidates: [{ species: 'Great Cormorant', confidence: 0.9 }],
      birdCenter: [95, 90],
    })

    const result = await identifyBirdInPhoto('data:image/jpeg;base64,test')

    // center (95,90) → x=min(60, 75)=60, y=min(60, 70)=60
    expect(result.cropBox).toEqual({ x: 60, y: 60, width: 40, height: 40 })
  })

  it('produces square pixel crop for landscape images', async () => {
    // Override Image mock to simulate a 3:2 landscape photo
    const OrigImage = globalThis.Image
    globalThis.Image = class {
      width = 300; height = 200
      onload: (() => void) | null = null
      onerror: ((e: any) => void) | null = null
      set src(_: string) { setTimeout(() => this.onload?.(), 0) }
    } as any

    mockLLMResponse({
      candidates: [{ species: 'Great Cormorant', confidence: 0.9 }],
      birdCenter: [30, 40],
    })

    const result = await identifyBirdInPhoto('data:image/jpeg;base64,test')

    // shortSide=200, cropPx=80
    // wPct = (80/300)*100 = 26.7 → 27, hPct = (80/200)*100 = 40
    // x = max(0, min(73, 30-13.3)) = 17, y = max(0, min(60, 40-20)) = 20
    expect(result.cropBox).toBeDefined()
    // Verify square in pixel space
    const pxW = (result.cropBox!.width / 100) * 300
    const pxH = (result.cropBox!.height / 100) * 200
    expect(Math.abs(pxW - pxH)).toBeLessThanOrEqual(3) // within rounding

    globalThis.Image = OrigImage
  })

  it('scales crop box based on birdSize', async () => {
    // "large" bird on 100x100 mock image → 75% crop
    mockLLMResponse({
      candidates: [{ species: 'Chukar', confidence: 0.9 }],
      birdCenter: [50, 55],
      birdSize: 'large',
    })

    const result = await identifyBirdInPhoto('data:image/jpeg;base64,test')

    // 75% of shortSide(100)=75 → wPct=75, hPct=75
    // x=max(0, min(25, 50-37.5))=13, y=max(0, min(25, 55-37.5))=18
    expect(result.cropBox).toEqual({ x: 13, y: 18, width: 75, height: 75 })
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
    expect(textPart).toContain('location/time')
  })
})
