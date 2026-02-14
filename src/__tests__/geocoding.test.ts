import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { forwardGeocode } from '../lib/geocoding'

describe('forwardGeocode', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('returns null for empty query', async () => {
    expect(await forwardGeocode('')).toBeNull()
    expect(await forwardGeocode('   ')).toBeNull()
  })

  it('returns lat/lon/displayName on successful lookup', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            lat: '40.7828',
            lon: '-73.9654',
            display_name: 'Central Park, Manhattan, New York, USA',
          },
        ]),
    })

    const result = await forwardGeocode('Central Park, NYC')
    expect(result).not.toBeNull()
    expect(result!.lat).toBeCloseTo(40.7828, 4)
    expect(result!.lon).toBeCloseTo(-73.9654, 4)
    expect(result!.displayName).toBe('Central Park, Manhattan, New York, USA')

    // Verify correct API call
    expect(globalThis.fetch).toHaveBeenCalledOnce()
    const url = (globalThis.fetch as any).mock.calls[0][0] as string
    expect(url).toContain('nominatim.openstreetmap.org/search')
    expect(url).toContain('Central')
  })

  it('returns null when no results found', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    })

    const result = await forwardGeocode('xyznonexistent12345')
    expect(result).toBeNull()
  })

  it('throws on HTTP error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    })

    await expect(forwardGeocode('test')).rejects.toThrow('Nominatim 500')
  })

  it('trims whitespace from query', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          { lat: '51.5074', lon: '-0.1278', display_name: 'London, UK' },
        ]),
    })

    const result = await forwardGeocode('  London  ')
    expect(result).not.toBeNull()
    expect(result!.lat).toBeCloseTo(51.5074, 4)
  })

  it('uses query as fallback displayName when display_name missing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          { lat: '35.6762', lon: '139.6503' },
        ]),
    })

    const result = await forwardGeocode('Tokyo')
    expect(result).not.toBeNull()
    expect(result!.displayName).toBe('Tokyo')
  })
})
