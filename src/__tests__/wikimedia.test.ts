import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Import after mocking fetch
const { getWikimediaImage, getWikimediaSummary } = await import('@/lib/wikimedia')

function mockWikiResponse(data: Record<string, unknown> | null) {
  if (data === null) {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })
  } else {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => data })
  }
}

function wikiData(overrides: Record<string, unknown> = {}) {
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
    // Clear module-level caches by re-importing (they're Maps)
    // We just test fresh species names each test to avoid cache hits
  })

  it('returns image URL from common name (strategy 1)', async () => {
    mockWikiResponse(wikiData())
    const result = await getWikimediaImage('Unique Sparrow A')
    expect(result).toContain('upload.wikimedia.org')
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][0]).toContain('Unique_Sparrow_A')
  })

  it('falls back to scientific name (strategy 2) when common name has no image', async () => {
    // Strategy 1: common name — no image
    mockWikiResponse(wikiData({ thumbnail: undefined, originalimage: undefined }))
    // Strategy 2: scientific name — has image
    mockWikiResponse(wikiData({
      thumbnail: { source: 'https://upload.wikimedia.org/thumb/300px-sci.jpg' },
      originalimage: undefined,
    }))

    const result = await getWikimediaImage('Unique Warbler B (Scientificus nameicus)')
    expect(result).toContain('sci.jpg')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('falls back to common name + " bird" (strategy 3) when both fail', async () => {
    // Strategy 1: no image
    mockWikiResponse(wikiData({ thumbnail: undefined, originalimage: undefined }))
    // Strategy 2: scientific name — no match (404)
    mockWikiResponse(null)
    // Strategy 3: common name + " bird" — has image
    mockWikiResponse(wikiData({
      thumbnail: { source: 'https://upload.wikimedia.org/thumb/300px-fallback.jpg' },
      originalimage: undefined,
    }))

    const result = await getWikimediaImage('Unique Robin C (Turdus uniqueus)')
    expect(result).toContain('fallback.jpg')
    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(mockFetch.mock.calls[1][0]).toContain('Turdus_uniqueus')
    expect(mockFetch.mock.calls[2][0]).toContain('Unique_Robin_C_bird')
  })

  it('falls back to common name + " bird" when common and scientific have no image', async () => {
    // Strategy 1: common name — no image
    mockWikiResponse(wikiData({ thumbnail: undefined, originalimage: undefined }))
    // Strategy 2: scientific — no image
    mockWikiResponse(wikiData({ thumbnail: undefined, originalimage: undefined }))
    // Strategy 3: common name + " bird" — has image
    mockWikiResponse(wikiData({
      thumbnail: { source: 'https://upload.wikimedia.org/thumb/300px-fallback.jpg' },
      originalimage: undefined,
    }))

    const result = await getWikimediaImage('Unique Robin C2 (Turdus uniqueus2)')
    expect(result).toContain('fallback.jpg')
    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(mockFetch.mock.calls[2][0]).toContain('Unique_Robin_C2_bird')
  })

  it('returns undefined when all strategies fail', async () => {
    mockWikiResponse(wikiData({ thumbnail: undefined, originalimage: undefined }))
    mockWikiResponse(null)
    mockWikiResponse(wikiData({ thumbnail: undefined, originalimage: undefined }))

    const result = await getWikimediaImage('Nonexistent Flycatcher D')
    expect(result).toBeUndefined()
  })

  it('prefers thumbnail URL when available', async () => {
    mockWikiResponse(wikiData({
      thumbnail: { source: 'https://upload.wikimedia.org/thumb/100px-bird.jpg' },
      originalimage: { source: 'https://upload.wikimedia.org/original-bird.jpg' },
    }))

    const result = await getWikimediaImage('Unique Finch E', 500)
    expect(result).toContain('100px-bird.jpg')
  })

  it('caches results for subsequent calls', async () => {
    mockWikiResponse(wikiData())

    const result1 = await getWikimediaImage('Unique Owl F')
    const result2 = await getWikimediaImage('Unique Owl F')

    expect(result1).toBe(result2)
    // Only 1 fetch call since second was cached
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('skips scientific name fallback when none is provided', async () => {
    // Strategy 1: no image
    mockWikiResponse(wikiData({ thumbnail: undefined, originalimage: undefined }))
    // Strategy 3 (no strategy 2 since no scientific name): common name + " bird"
    mockWikiResponse(wikiData({
      thumbnail: { source: 'https://upload.wikimedia.org/thumb/300px-bird-suffix.jpg' },
      originalimage: undefined,
    }))

    const result = await getWikimediaImage('Unique Heron G')
    expect(result).toContain('bird-suffix.jpg')
    // Only 2 calls: common name → common name + " bird" (no scientific name)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('tries dehyphenated common name after common/scientific/common+bird for hyphenated species', async () => {
    mockWikiResponse(wikiData({ thumbnail: undefined, originalimage: undefined }))
    mockWikiResponse(wikiData({ thumbnail: undefined, originalimage: undefined }))
    mockWikiResponse(wikiData({
      thumbnail: { source: 'https://upload.wikimedia.org/thumb/300px-dehyphenated.jpg' },
      originalimage: undefined,
    }))

    const result = await getWikimediaImage('Unique-Hyphenated Bird M')
    expect(result).toContain('dehyphenated.jpg')
    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(mockFetch.mock.calls[0][0]).toContain('Unique-Hyphenated_Bird_M')
    expect(mockFetch.mock.calls[2][0]).toContain('Unique_Hyphenated_Bird_M')
  })
})

// ── getWikimediaSummary ─────────────────────────────────────

describe('getWikimediaSummary', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('returns summary with title, extract, imageUrl, and pageUrl', async () => {
    mockWikiResponse(wikiData({
      title: 'Northern Cardinal',
      extract: 'The northern cardinal is a songbird.',
      originalimage: { source: 'https://upload.wikimedia.org/cardinal.jpg' },
      content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Northern_Cardinal' } },
    }))

    const result = await getWikimediaSummary('Unique Cardinal H')
    expect(result).toBeDefined()
    expect(result!.title).toBe('Northern Cardinal')
    expect(result!.extract).toContain('songbird')
    expect(result!.imageUrl).toContain('100px-bird.jpg')
    expect(result!.pageUrl).toContain('Northern_Cardinal')
  })

  it('returns undefined when all strategies fail', async () => {
    mockWikiResponse(wikiData({ extract: undefined }))
    mockWikiResponse(null)
    mockWikiResponse(wikiData({ extract: undefined }))

    const result = await getWikimediaSummary('Nonexistent Bird I')
    expect(result).toBeUndefined()
  })

  it('tries scientific name when common name lacks extract', async () => {
    mockWikiResponse(wikiData({ extract: undefined }))
    mockWikiResponse(wikiData({
      title: 'Cyanocitta cristata',
      extract: 'A corvid native to eastern North America.',
    }))

    const result = await getWikimediaSummary('Unique Jay J (Cyanocitta cristata)')
    expect(result).toBeDefined()
    expect(result!.extract).toContain('corvid')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('falls back to common name when scientific summary is missing and no cache collision', async () => {
    mockWikiResponse(wikiData({ extract: undefined }))
    mockWikiResponse(wikiData({
      title: 'Unique Jay J',
      extract: 'Found via common name fallback.',
    }))

    const result = await getWikimediaSummary('Unique Jay J2 (Cyanocitta cristata2)')
    expect(result).toBeDefined()
    expect(result!.extract).toContain('common name fallback')
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch.mock.calls[0][0]).toContain('Unique_Jay_J2')
    expect(mockFetch.mock.calls[1][0]).toContain('Cyanocitta_cristata2')
  })

  it('caches results for subsequent calls', async () => {
    mockWikiResponse(wikiData({ extract: 'Cached bird.' }))

    const result1 = await getWikimediaSummary('Unique Wren K')
    const result2 = await getWikimediaSummary('Unique Wren K')

    expect(result1).toEqual(result2)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('uses WIKI_OVERRIDES to disambiguate species like Merlin', async () => {
    mockWikiResponse(wikiData({
      title: 'Merlin (bird)',
      extract: 'The merlin is a small species of falcon.',
    }))

    const result = await getWikimediaSummary('Merlin (Falco columbarius)')
    expect(result).toBeDefined()
    expect(result!.title).toBe('Merlin (bird)')
    expect(result!.extract).toContain('falcon')
    // Should fetch the override title "Merlin (bird)", not bare "Merlin"
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][0]).toContain('Merlin_(bird)')
  })

  it('handles fetch errors gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    const result = await getWikimediaSummary('Unique Dove L')
    expect(result).toBeUndefined()
  })

  it('tries dehyphenated common name last for summary lookups', async () => {
    mockWikiResponse(wikiData({ extract: undefined }))
    mockWikiResponse(wikiData({ extract: undefined }))
    mockWikiResponse(wikiData({
      title: 'Unique Hyphenated Bird M',
      extract: 'Found via dehyphenated title.',
    }))

    const result = await getWikimediaSummary('Unique-Hyphenated Bird M')
    expect(result).toBeDefined()
    expect(result!.extract).toContain('dehyphenated')
    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(mockFetch.mock.calls[0][0]).toContain('Unique-Hyphenated_Bird_M')
    expect(mockFetch.mock.calls[2][0]).toContain('Unique_Hyphenated_Bird_M')
  })
})
