import { describe, it, expect, vi, beforeEach } from 'vitest'

/** Queued Wikipedia responses (consumed FIFO). */
const wikiQueue: Array<{ ok: boolean; status?: number; json?: () => Promise<unknown> }> = []

/** Override the wiki-title API response for a specific test. */
let wikiTitleOverride: { wikiTitle: string | null; common: string | null; scientific: string | null } | null = null

const mockFetch = vi.fn((url: string) => {
  if (typeof url === 'string' && url.includes('/api/species/wiki-title')) {
    const body = wikiTitleOverride ?? { wikiTitle: null, common: null, scientific: null }
    return Promise.resolve({ ok: true, json: async () => body })
  }
  // Dequeue the next Wikipedia response
  const next = wikiQueue.shift()
  if (next) return Promise.resolve(next)
  return Promise.resolve({ ok: false, status: 404 })
})

vi.stubGlobal('fetch', mockFetch)

// Import after mocking
const { getWikimediaImage, getWikimediaSummary } = await import('@/lib/wikimedia')

function mockWikiResponse(data: Record<string, unknown> | null) {
  if (data === null) {
    wikiQueue.push({ ok: false, status: 404 })
  } else {
    wikiQueue.push({
      ok: true,
      json: async () => data,
    })
  }
}

function mockTransientError() {
  wikiQueue.push({ ok: false, status: 500 })
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

// == getWikimediaImage ========================================

/** Return only the fetch calls to Wikipedia (not the wiki-title API). */
function wikiCalls() {
  return mockFetch.mock.calls.filter(
    ([url]: [string]) => !url.includes('/api/species/wiki-title')
  )
}

describe('getWikimediaImage', () => {
  beforeEach(() => {
    mockFetch.mockClear()
    wikiQueue.length = 0
    wikiTitleOverride = null
  })

  it('uses species display name for lookup (single fetch)', async () => {
    mockWikiResponse(wikiPageData({
      thumbnail: { source: 'https://upload.wikimedia.org/thumb/300px-hummingbird.jpg' },
    }))

    const result = await getWikimediaImage('Ruby-throated hummingbird (Archilochus colubris)')
    expect(result).toContain('hummingbird.jpg')
    expect(wikiCalls()).toHaveLength(1)
    expect(wikiCalls()[0][0]).toContain('Ruby-throated_hummingbird')
  })

  it('uses taxonomy wikiTitle for Chukar image lookup', async () => {
    wikiTitleOverride = { wikiTitle: 'Chukar partridge', common: 'Chukar', scientific: 'Alectoris chukar' }
    mockWikiResponse(wikiPageData({
      thumbnail: { source: 'https://upload.wikimedia.org/thumb/chukar.jpg' },
    }))

    const result = await getWikimediaImage('Chukar (Alectoris chukar)')
    expect(result).toContain('chukar.jpg')
    expect(wikiCalls()).toHaveLength(1)
    expect(wikiCalls()[0][0]).toContain('Chukar_partridge')
  })

  it('returns undefined when species page is missing', async () => {
    mockWikiResponse(null)

    const result = await getWikimediaImage('Unknown Bird X')
    expect(result).toBeUndefined()
    expect(wikiCalls().length).toBeGreaterThanOrEqual(1)
  })

  it('returns undefined when wiki page has no image', async () => {
    mockWikiResponse(wikiPageData({ thumbnail: undefined, originalimage: undefined }))

    const result = await getWikimediaImage('Unique Warbler B2')
    expect(result).toBeUndefined()
    expect(wikiCalls()).toHaveLength(1)
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
    // Must use the URL exactly as returned by Wikipedia -- upsizing beyond the
    // original image dimensions causes a 404 on Wikimedia servers, which
    // breaks thumbnails on iOS Safari and other browsers.
    expect(result).toBe('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Bird.jpg/220px-Bird.jpg')
  })

  it('tries alternate titles when first hit has no image', async () => {
    wikiTitleOverride = { wikiTitle: 'Imageless Bird', common: 'Imageful Bird', scientific: null }
    mockWikiResponse(wikiPageData({
      title: 'Imageless Bird',
      thumbnail: undefined,
      originalimage: undefined,
    }))
    mockWikiResponse(wikiPageData({
      title: 'Imageful Bird',
      thumbnail: { source: 'https://upload.wikimedia.org/thumb/imageful.jpg' },
    }))

    const result = await getWikimediaImage('Imageful Bird (Testus imagus)')
    expect(result).toContain('imageful.jpg')
    expect(wikiCalls()).toHaveLength(2)
    expect(wikiCalls()[0][0]).toContain('Imageless_Bird')
    expect(wikiCalls()[1][0]).toContain('Imageful_Bird')
  })

  it('caches results for subsequent calls', async () => {
    mockWikiResponse(wikiPageData())

    const result1 = await getWikimediaImage('Unique Owl F')
    const result2 = await getWikimediaImage('Unique Owl F')

    expect(result1).toBe(result2)
    expect(wikiCalls()).toHaveLength(1)
  })

  it('does not cache transient errors so retries are possible', async () => {
    mockTransientError()

    const result1 = await getWikimediaImage('Retry Bird G')
    expect(result1).toBeUndefined()
    const firstWikiCallCount = wikiCalls().length

    // Second call should retry (not serve from cache)
    mockWikiResponse(wikiPageData({
      thumbnail: { source: 'https://upload.wikimedia.org/thumb/retry-bird.jpg' },
    }))
    const result2 = await getWikimediaImage('Retry Bird G')
    expect(result2).toContain('retry-bird.jpg')
    expect(wikiCalls().length).toBeGreaterThan(firstWikiCallCount)
  })
})

// == getWikimediaSummary ======================================

describe('getWikimediaSummary', () => {
  beforeEach(() => {
    mockFetch.mockClear()
    wikiQueue.length = 0
    wikiTitleOverride = null
  })

  it('uses species display name for summary lookup (single fetch)', async () => {
    wikiTitleOverride = { wikiTitle: 'Merlin (bird)', common: 'Merlin', scientific: 'Falco columbarius' }
    mockWikiResponse(wikiPageData({
      title: 'Merlin (bird)',
      extract: 'The merlin is a small species of falcon.',
    }))

    const result = await getWikimediaSummary('Merlin T2 (Falco columbarius)')
    expect(result).toBeDefined()
    expect(result!.title).toBe('Merlin (bird)')
    expect(result!.extract).toContain('falcon')
    expect(wikiCalls()).toHaveLength(1)
    expect(wikiCalls()[0][0]).toContain('Merlin_(bird)')
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
    expect(wikiCalls().length).toBeGreaterThanOrEqual(1)
  })

  it('returns undefined when wiki page has no extract', async () => {
    mockWikiResponse(wikiPageData({ extract: undefined }))

    const result = await getWikimediaSummary('Unique Empty Z')
    expect(result).toBeUndefined()
    expect(wikiCalls()).toHaveLength(1)
  })

  it('uses first hit text with later hit image when first has no image', async () => {
    wikiTitleOverride = { wikiTitle: 'Textful Bird', common: 'Imageful Bird', scientific: null }
    mockWikiResponse(wikiPageData({
      title: 'Textful Bird',
      extract: 'Best summary text.',
      thumbnail: undefined,
      originalimage: undefined,
      content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Textful_Bird' } },
    }))
    mockWikiResponse(wikiPageData({
      title: 'Imageful Bird',
      extract: 'Other summary.',
      thumbnail: { source: 'https://upload.wikimedia.org/thumb/img.jpg' },
      originalimage: { source: 'https://upload.wikimedia.org/img-full.jpg' },
    }))

    const result = await getWikimediaSummary('Imageful Bird SUM (Testus textus)')
    expect(result).toBeDefined()
    // Text from first hit
    expect(result!.title).toBe('Textful Bird')
    expect(result!.extract).toBe('Best summary text.')
    expect(result!.pageUrl).toContain('Textful_Bird')
    // Image from second hit
    expect(result!.imageUrl).toContain('img-full.jpg')
  })

  it('caches results for subsequent calls', async () => {
    mockWikiResponse(wikiPageData({ extract: 'Cached bird.' }))

    const result1 = await getWikimediaSummary('Unique Wren K')
    const result2 = await getWikimediaSummary('Unique Wren K')

    expect(result1).toEqual(result2)
    expect(wikiCalls()).toHaveLength(1)
  })

  it('handles fetch errors gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    const result = await getWikimediaSummary('Unique Dove L')
    expect(result).toBeUndefined()
  })
})

// == Shared cache =============================================

describe('shared cache between image and summary', () => {
  beforeEach(() => {
    mockFetch.mockClear()
    wikiQueue.length = 0
    wikiTitleOverride = null
  })

  it('getWikimediaSummary reuses the fetch from getWikimediaImage (no duplicate API call)', async () => {
    mockWikiResponse(wikiPageData({
      title: 'Peregrine Falcon',
      extract: 'The peregrine falcon is the fastest bird.',
      thumbnail: { source: 'https://upload.wikimedia.org/thumb/peregrine.jpg' },
      originalimage: { source: 'https://upload.wikimedia.org/peregrine-full.jpg' },
      content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Peregrine_Falcon' } },
    }))

    // First: image fetch (like list view BirdRow)
    const imageUrl = await getWikimediaImage('Unique Peregrine SC1')
    expect(imageUrl).toContain('peregrine.jpg')
    const callsAfterImage = wikiCalls().length

    // Second: summary fetch (like detail view) -- should NOT make another Wikipedia call
    const summary = await getWikimediaSummary('Unique Peregrine SC1')
    expect(summary).toBeDefined()
    expect(summary!.extract).toContain('fastest bird')
    expect(summary!.imageUrl).toBe('https://upload.wikimedia.org/peregrine-full.jpg')
    expect(wikiCalls()).toHaveLength(callsAfterImage) // no new Wikipedia calls
  })

  it('getWikimediaImage reuses the fetch from getWikimediaSummary', async () => {
    mockWikiResponse(wikiPageData({
      thumbnail: { source: 'https://upload.wikimedia.org/thumb/osprey.jpg' },
      originalimage: { source: 'https://upload.wikimedia.org/osprey-full.jpg' },
    }))

    const summary = await getWikimediaSummary('Unique Osprey SC2')
    expect(summary).toBeDefined()
    const callsAfterSummary = wikiCalls().length

    const imageUrl = await getWikimediaImage('Unique Osprey SC2')
    expect(imageUrl).toContain('osprey.jpg')
    expect(wikiCalls()).toHaveLength(callsAfterSummary) // no new Wikipedia calls
  })
})

