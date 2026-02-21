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

const { identifyBirdInPhoto } = await import('@/lib/ai-inference')

function mockApiResponse(json: any) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => json,
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

  it('returns structured server payload', async () => {
    mockApiResponse({
      candidates: [
        { species: 'Northern Cardinal (Cardinalis cardinalis)', confidence: 0.92 },
        { species: 'Pyrrhuloxia (Cardinalis sinuatus)', confidence: 0.45 },
      ],
      cropBox: { x: 22, y: 18, width: 42, height: 42 },
      multipleBirds: false,
    })

    const result = await identifyBirdInPhoto('data:image/jpeg;base64,test')

    expect(result.candidates).toHaveLength(2)
    expect(result.candidates[0].species).toBe('Northern Cardinal (Cardinalis cardinalis)')
    expect(result.candidates[0].confidence).toBe(0.92)
    expect(result.cropBox).toEqual({ x: 22, y: 18, width: 42, height: 42 })
    expect(result.multipleBirds).toBe(false)
  })

  it('reports multipleBirds when API flags it', async () => {
    mockApiResponse({
      candidates: [
        { species: 'Glaucous-winged Gull', confidence: 0.85 },
        { species: 'Common Goldeneye', confidence: 0.55 },
      ],
      multipleBirds: true,
    })

    const result = await identifyBirdInPhoto('data:image/jpeg;base64,test')

    expect(result.multipleBirds).toBe(true)
    expect(result.candidates.length).toBeGreaterThan(0)
  })

  it('passes through candidate ordering from API', async () => {
    mockApiResponse({
      candidates: [
        { species: 'Grey Heron', confidence: 0.74 },
        { species: 'Great Blue Heron', confidence: 0.89 },
        { species: 'Great Egret', confidence: 0.42 },
      ],
      cropBox: undefined,
    })

    const result = await identifyBirdInPhoto(
      'data:image/jpeg;base64,test',
      { lat: 47.6062, lon: -122.3321 },
      6,
      'Seattle, Washington, USA'
    )

    expect(result.candidates.map(c => c.confidence)).toEqual([0.74, 0.89, 0.42])
  })

  it('returns empty candidates when API finds no bird', async () => {
    mockApiResponse({
      candidates: [],
      cropBox: undefined,
    })

    const result = await identifyBirdInPhoto('data:image/jpeg;base64,test')

    expect(result.candidates).toHaveLength(0)
    expect(result.cropBox).toBeUndefined()
  })

  it('throws informative error on 429 rate limit', async () => {
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

  it('passes GPS context fields to the identify API request', async () => {
    mockApiResponse({
      candidates: [{ species: 'Bald Eagle', confidence: 0.9 }],
      cropBox: null,
    })

    await identifyBirdInPhoto(
      'data:image/jpeg;base64,test',
      { lat: 40.7128, lon: -74.006 },
      5 // June
    )

    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/identify-bird')
    const body = opts.body as FormData
    expect(body.get('lat')).toBe('40.7128')
    expect(body.get('lon')).toBe('-74.006')
    expect(body.get('month')).toBe('5')
  })

  it('passes location name context field to the identify API request', async () => {
    mockApiResponse({
      candidates: [{ species: 'Eastern Cattle-Egret', confidence: 0.9 }],
      cropBox: null,
    })

    await identifyBirdInPhoto(
      'data:image/jpeg;base64,test',
      { lat: 25.0306, lon: 121.5354 },
      11, // December
      "Da'an District, Taipei, Taiwan"
    )

    const [, opts] = mockFetch.mock.calls[0]
    const body = opts.body as FormData
    expect(body.get('locationName')).toBe("Da'an District, Taipei, Taiwan")
    expect(body.get('lat')).toBe('25.0306')
    expect(body.get('lon')).toBe('121.5354')
    expect(body.get('month')).toBe('11')
  })
})
