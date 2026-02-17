import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock getWikiTitle so tests control whether species have pre-resolved titles
const mockGetWikiTitle = vi.fn<(name: string) => string | undefined>().mockReturnValue(undefined)
vi.mock('@/lib/taxonomy', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return { ...actual, getWikiTitle: (...args: [string]) => mockGetWikiTitle(...args) }
})

// Import after mocking
const { getWikimediaImage, getWikimediaSummary } = await import('@/lib/wikimedia')

function mockWikiResponse(pageData: Record<string, unknown> | null | 'missing') {
  if (pageData === null) {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })
  } else if (pageData === 'missing') {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ query: { pages: [{ missing: true }] } }),
    })
  } else {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ query: { pages: [pageData] } }),
    })
  }
}

function wikiPageData(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Test Bird',
    extract: 'A small bird.',
    thumbnail: { source: 'https://upload.wikimedia.org/thumb/100px-bird.jpg' },
    original: { source: 'https://upload.wikimedia.org/bird.jpg' },
    fullurl: 'https://en.wikipedia.org/wiki/Test_Bird',
    ...overrides,
  }
}

// ── getWikimediaImage ───────────────────────────────────────

describe('getWikimediaImage', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockGetWikiTitle.mockReturnValue(undefined)
  })

  it('uses pre-resolved wiki title from taxonomy (single fetch)', async () => {
    mockGetWikiTitle.mockReturnValue('Ruby-throated hummingbird')
    mockWikiResponse(wikiPageData({
      thumbnail: { source: 'https://upload.wikimedia.org/thumb/300px-hummingbird.jpg' },
    }))

    const result = await getWikimediaImage('Unique Hummingbird T1')
    expect(result).toContain('hummingbird.jpg')
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][0]).toContain('Ruby-throated_hummingbird')
  })

  it('returns image URL from common name when no wiki title (fallback)', async () => {
    mockWikiResponse(wikiPageData())
    const result = await getWikimediaImage('Unique Sparrow A')
    expect(result).toContain('upload.wikimedia.org')
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][0]).toContain('Unique_Sparrow_A')
  })

  it('falls back to scientific name when common name has no image', async () => {
    // common name — no image
    mockWikiResponse(wikiPageData({ thumbnail: undefined, original: undefined }))
    // scientific name — has image
    mockWikiResponse(wikiPageData({
      thumbnail: { source: 'https://upload.wikimedia.org/thumb/300px-sci.jpg' },
      original: undefined,
    }))

    const result = await getWikimediaImage('Unique Warbler B (Scientificus nameicus)')
    expect(result).toContain('sci.jpg')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('falls back to common name + " bird" when common and scientific fail', async () => {
    // common name: no image
    mockWikiResponse(wikiPageData({ thumbnail: undefined, original: undefined }))
    // scientific name: 404
    mockWikiResponse(null)
    // common name + " bird": has image
    mockWikiResponse(wikiPageData({
      thumbnail: { source: 'https://upload.wikimedia.org/thumb/300px-fallback.jpg' },
      original: undefined,
    }))

    const result = await getWikimediaImage('Unique Robin C (Turdus uniqueus)')
    expect(result).toContain('fallback.jpg')
    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(mockFetch.mock.calls[1][0]).toContain('Turdus_uniqueus')
    expect(mockFetch.mock.calls[2][0]).toContain('Unique_Robin_C_bird')
  })

  it('returns undefined when all fallback strategies fail', async () => {
    mockWikiResponse(wikiPageData({ thumbnail: undefined, original: undefined }))
    mockWikiResponse('missing')
    mockWikiResponse(wikiPageData({ thumbnail: undefined, original: undefined }))

    const result = await getWikimediaImage('Nonexistent Flycatcher D')
    expect(result).toBeUndefined()
  })

  it('prefers thumbnail URL when available', async () => {
    mockWikiResponse(wikiPageData({
      thumbnail: { source: 'https://upload.wikimedia.org/thumb/100px-bird.jpg' },
      original: { source: 'https://upload.wikimedia.org/original-bird.jpg' },
    }))

    const result = await getWikimediaImage('Unique Finch E', 500)
    expect(result).toContain('100px-bird.jpg')
  })

  it('caches results for subsequent calls', async () => {
    mockWikiResponse(wikiPageData())

    const result1 = await getWikimediaImage('Unique Owl F')
    const result2 = await getWikimediaImage('Unique Owl F')

    expect(result1).toBe(result2)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('skips scientific name fallback when none is provided', async () => {
    // common name: no image
    mockWikiResponse(wikiPageData({ thumbnail: undefined, original: undefined }))
    // common name + " bird"
    mockWikiResponse(wikiPageData({
      thumbnail: { source: 'https://upload.wikimedia.org/thumb/300px-bird-suffix.jpg' },
      original: undefined,
    }))

    const result = await getWikimediaImage('Unique Heron G')
    expect(result).toContain('bird-suffix.jpg')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})

// ── getWikimediaSummary ─────────────────────────────────────

describe('getWikimediaSummary', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockGetWikiTitle.mockReturnValue(undefined)
  })

  it('uses pre-resolved wiki title from taxonomy (single fetch)', async () => {
    mockGetWikiTitle.mockReturnValue('Merlin (bird)')
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
      original: { source: 'https://upload.wikimedia.org/cardinal.jpg' },
      fullurl: 'https://en.wikipedia.org/wiki/Northern_Cardinal',
    }))

    const result = await getWikimediaSummary('Unique Cardinal H')
    expect(result).toBeDefined()
    expect(result!.title).toBe('Northern Cardinal')
    expect(result!.extract).toContain('songbird')
    expect(result!.imageUrl).toContain('100px-bird.jpg')
    expect(result!.pageUrl).toContain('Northern_Cardinal')
  })

  it('returns undefined when all strategies fail', async () => {
    mockWikiResponse(wikiPageData({ extract: undefined }))
    mockWikiResponse(null)
    mockWikiResponse(wikiPageData({ extract: undefined }))

    const result = await getWikimediaSummary('Nonexistent Bird I')
    expect(result).toBeUndefined()
  })

  it('tries scientific name when common name lacks extract', async () => {
    mockWikiResponse(wikiPageData({ extract: undefined }))
    mockWikiResponse(wikiPageData({
      title: 'Cyanocitta cristata',
      extract: 'A corvid native to eastern North America.',
    }))

    const result = await getWikimediaSummary('Unique Jay J (Cyanocitta cristata)')
    expect(result).toBeDefined()
    expect(result!.extract).toContain('corvid')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('falls back to scientific name when common summary is missing', async () => {
    mockWikiResponse(wikiPageData({ extract: undefined }))
    mockWikiResponse(wikiPageData({
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
    mockWikiResponse(wikiPageData({ extract: 'Cached bird.' }))

    const result1 = await getWikimediaSummary('Unique Wren K')
    const result2 = await getWikimediaSummary('Unique Wren K')

    expect(result1).toEqual(result2)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('handles fetch errors gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    const result = await getWikimediaSummary('Unique Dove L')
    expect(result).toBeUndefined()
  })
})

