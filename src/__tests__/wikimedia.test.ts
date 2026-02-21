import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Import after mocking
const { getWikimediaImage, getWikimediaSummary } = await import('@/lib/wikimedia')

function mockWikiResponse(data: Record<string, unknown> | null) {
  if (data === null) {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })
  } else {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => data,
    })
  }
}

function mockTransientError() {
  mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
}

function wikiPageData(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Test Bird',
    extract: 'A small bird.',
    thumbnail: { source: 'https://upload.wikimedia.org/thumb/100px-bird.jpg' },
    originalimage: { source: 'https://upload.wikimedia.org/bird.jpg' },
    content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Test_Bird' } },
    ...overrides,
  }
}

// ── getWikimediaImage ───────────────────────────────────────

describe('getWikimediaImage', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('uses species display name for lookup (single fetch)', async () => {
    mockWikiResponse(wikiPageData({
      thumbnail: { source: 'https://upload.wikimedia.org/thumb/300px-hummingbird.jpg' },
    }))

    const result = await getWikimediaImage('Ruby-throated hummingbird (Archilochus colubris)')
    expect(result).toContain('hummingbird.jpg')
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][0]).toContain('Ruby-throated_hummingbird')
  })

  it('uses taxonomy wikiTitle for Chukar image lookup', async () => {
    mockWikiResponse(wikiPageData({
      thumbnail: { source: 'https://upload.wikimedia.org/thumb/chukar.jpg' },
    }))

    const result = await getWikimediaImage('Chukar (Alectoris chukar)')
    expect(result).toContain('chukar.jpg')
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][0]).toContain('Chukar_partridge')
  })

  it('returns undefined when species page is missing', async () => {
    mockWikiResponse(null)

    const result = await getWikimediaImage('Unknown Bird X')
    expect(result).toBeUndefined()
    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  it('returns undefined when wiki page has no image', async () => {
    mockWikiResponse(wikiPageData({ thumbnail: undefined, originalimage: undefined }))

    const result = await getWikimediaImage('Unique Warbler B2')
    expect(result).toBeUndefined()
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('prefers thumbnail URL when available', async () => {
    mockWikiResponse(wikiPageData({
      thumbnail: { source: 'https://upload.wikimedia.org/thumb/100px-bird.jpg' },
      originalimage: { source: 'https://upload.wikimedia.org/original-bird.jpg' },
    }))

    const result = await getWikimediaImage('Unique Finch E')
    expect(result).toBe('https://upload.wikimedia.org/thumb/100px-bird.jpg')
  })

  it('does not upsize thumbnail URL to avoid 404 on small originals (iOS regression)', async () => {
    mockWikiResponse(wikiPageData({
      thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Bird.jpg/220px-Bird.jpg' },
    }))

    const result = await getWikimediaImage('Small Image Bird R')
    // Must use the URL exactly as returned by Wikipedia — upsizing beyond the
    // original image dimensions causes a 404 on Wikimedia servers, which
    // breaks thumbnails on iOS Safari and other browsers.
    expect(result).toBe('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Bird.jpg/220px-Bird.jpg')
  })

  it('caches results for subsequent calls', async () => {
    mockWikiResponse(wikiPageData())

    const result1 = await getWikimediaImage('Unique Owl F')
    const result2 = await getWikimediaImage('Unique Owl F')

    expect(result1).toBe(result2)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('does not cache transient errors so retries are possible', async () => {
    mockTransientError()

    const result1 = await getWikimediaImage('Retry Bird G')
    expect(result1).toBeUndefined()
    const firstCallCount = mockFetch.mock.calls.length

    // Second call should retry (not serve from cache)
    mockWikiResponse(wikiPageData({
      thumbnail: { source: 'https://upload.wikimedia.org/thumb/retry-bird.jpg' },
    }))
    const result2 = await getWikimediaImage('Retry Bird G')
    expect(result2).toContain('retry-bird.jpg')
    expect(mockFetch.mock.calls.length).toBeGreaterThan(firstCallCount)
  })
})

// ── getWikimediaSummary ─────────────────────────────────────

describe('getWikimediaSummary', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('uses species display name for summary lookup (single fetch)', async () => {
    mockWikiResponse(wikiPageData({
      title: 'Merlin (bird)',
      extract: 'The merlin is a small species of falcon.',
    }))

    const result = await getWikimediaSummary('Merlin T2 (Falco columbarius)')
    expect(result).toBeDefined()
    expect(result!.title).toBe('Merlin (bird)')
    expect(result!.extract).toContain('falcon')
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][0]).toContain('Merlin_(bird)')
  })

  it('returns summary with title, extract, imageUrl, and pageUrl', async () => {
    mockWikiResponse(wikiPageData({
      title: 'Northern Cardinal',
      extract: 'The northern cardinal is a songbird.',
      originalimage: { source: 'https://upload.wikimedia.org/cardinal.jpg' },
      content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Northern_Cardinal' } },
    }))

    const result = await getWikimediaSummary('Unique Cardinal H')
    expect(result).toBeDefined()
    expect(result!.title).toBe('Northern Cardinal')
    expect(result!.extract).toContain('songbird')
    expect(result!.imageUrl).toContain('cardinal.jpg')
    expect(result!.pageUrl).toContain('Northern_Cardinal')
  })

  it('returns undefined when species summary page is missing', async () => {
    mockWikiResponse(null)

    const result = await getWikimediaSummary('Unknown Bird Y')
    expect(result).toBeUndefined()
    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  it('returns undefined when wiki page has no extract', async () => {
    mockWikiResponse(wikiPageData({ extract: undefined }))

    const result = await getWikimediaSummary('Unique Empty Z')
    expect(result).toBeUndefined()
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('caches results for subsequent calls', async () => {
    mockWikiResponse(wikiPageData({ extract: 'Cached bird.' }))

    const result1 = await getWikimediaSummary('Unique Wren K')
    const result2 = await getWikimediaSummary('Unique Wren K')

    expect(result1).toEqual(result2)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('handles fetch errors gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    const result = await getWikimediaSummary('Unique Dove L')
    expect(result).toBeUndefined()
  })
})

