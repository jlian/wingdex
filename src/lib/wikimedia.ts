/**
 * Fetch bird images and summaries from Wikipedia Action API.
 * Uses pre-resolved Wikipedia article titles from taxonomy.json (hydrated at build time
 * by scripts/hydrate-wiki-titles.mjs) for a single-fetch lookup per species.
 * Falls back to common name for species not in the taxonomy.
 * No API key required.
 */
import { getDisplayName, getScientificName } from './utils'
import { getWikiTitle } from './taxonomy'

const imageCache = new Map<string, string | null>()
const summaryCache = new Map<string, WikiSummary | null>()
const imageInFlight = new Map<string, Promise<string | undefined>>()
const summaryInFlight = new Map<string, Promise<WikiSummary | undefined>>()

export interface WikiSummary {
  title: string
  extract: string
  imageUrl?: string
  pageUrl: string
}

type WikiSummaryPayload = {
  thumbnail?: { source: string }
  originalimage?: { source: string }
  extract?: string
  content_urls?: { desktop?: { page?: string } }
  title?: string
}

type FetchSummaryResult =
  | { kind: 'hit'; data: WikiSummaryPayload }
  | { kind: 'miss' }
  | { kind: 'error' }

/** Fetch a Wikipedia page summary and classify hit/miss/error for caching decisions. */
async function fetchSummary(title: string): Promise<FetchSummaryResult> {
  try {
    const normalizedTitle = title.replace(/ /g, '_')
    const encodedTitle = encodeURIComponent(normalizedTitle)
    const res = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*&redirects=1&prop=extracts%7Cpageimages%7Cinfo&inprop=url&exintro=1&explaintext=1&piprop=thumbnail%7Coriginal&pithumbsize=600&titles=${encodedTitle}`
    )
    if (!res.ok && res.status !== 404) {
      console.warn(`[wikimedia] Unexpected summary response ${res.status} for "${title}"`)
      return { kind: 'error' }
    }
    if (!res.ok) return { kind: 'miss' }
    const payload = await res.json() as {
      query?: {
        pages?: Array<{
          missing?: boolean
          title?: string
          extract?: string
          thumbnail?: { source?: string }
          original?: { source?: string }
          fullurl?: string
        }>
      }
    }

    const page = payload.query?.pages?.[0]
    if (!page || page.missing) return { kind: 'miss' }

    return {
      kind: 'hit',
      data: {
        title: page.title,
        extract: page.extract,
        thumbnail: page.thumbnail?.source ? { source: page.thumbnail.source } : undefined,
        originalimage: page.original?.source ? { source: page.original.source } : undefined,
        content_urls: page.fullurl ? { desktop: { page: page.fullurl } } : undefined,
      },
    }
  } catch {
    return { kind: 'error' }
  }
}

/** Extract image URL from a Wikipedia summary response */
function extractImageUrl(data: WikiSummaryPayload, _size: number): string | undefined {
  if (data.thumbnail?.source) {
    return data.thumbnail.source
  }
  if (data.originalimage?.source) {
    return data.originalimage.source
  }
  return undefined
}

/**
 * Parse common and scientific names from a species string like "Northern Cardinal (Cardinalis cardinalis)"
 */
function parseSpeciesName(speciesName: string): { common: string; scientific?: string } {
  return { common: getDisplayName(speciesName), scientific: getScientificName(speciesName) }
}

/**
 * Build ordered list of Wikipedia title candidates for a species.
 * If a pre-resolved wikiTitle exists in taxonomy, it is the sole candidate.
 * Otherwise falls back to common name → scientific name → common + " bird".
 */
function getCandidates(common: string, scientific?: string): string[] {
  const wikiTitle = getWikiTitle(common)
  if (wikiTitle) return [wikiTitle]

  // Fallback for species not in taxonomy or without a hydrated wiki title
  const candidates = [common]
  if (scientific) candidates.push(scientific)
  candidates.push(`${common} bird`)
  return candidates
}

/**
 * Get a Wikimedia Commons thumbnail URL for a bird species.
 * Uses pre-resolved Wikipedia title from taxonomy when available (single fetch).
 */
export async function getWikimediaImage(
  speciesName: string,
  size = 300
): Promise<string | undefined> {
  const { common, scientific } = parseSpeciesName(speciesName)
  const cacheKey = common.toLowerCase()

  if (imageCache.has(cacheKey)) {
    const cached = imageCache.get(cacheKey)
    return cached ?? undefined
  }

  const inFlight = imageInFlight.get(cacheKey)
  if (inFlight) return inFlight

  const lookupPromise = (async (): Promise<string | undefined> => {
    let hadTransientError = false
    let imageUrl: string | undefined

    for (const candidate of getCandidates(common, scientific)) {
      const result = await fetchSummary(candidate)
      if (result.kind === 'hit') {
        imageUrl = extractImageUrl(result.data, size)
        if (imageUrl) break
      } else if (result.kind === 'error') {
        hadTransientError = true
      }
    }

    if (imageUrl) {
      imageCache.set(cacheKey, imageUrl)
    } else if (!hadTransientError) {
      imageCache.set(cacheKey, null)
    }
    return imageUrl
  })()

  imageInFlight.set(cacheKey, lookupPromise)
  try {
    return await lookupPromise
  } finally {
    imageInFlight.delete(cacheKey)
  }
}

/**
 * Get Wikipedia summary text + image for a bird species.
 * Uses pre-resolved Wikipedia title from taxonomy when available (single fetch).
 */
export async function getWikimediaSummary(
  speciesName: string
): Promise<WikiSummary | undefined> {
  const { common, scientific } = parseSpeciesName(speciesName)
  const cacheKey = common.toLowerCase()

  if (summaryCache.has(cacheKey)) {
    const cached = summaryCache.get(cacheKey)
    return cached ?? undefined
  }

  const inFlight = summaryInFlight.get(cacheKey)
  if (inFlight) return inFlight

  const lookupPromise = (async (): Promise<WikiSummary | undefined> => {
    let hadTransientError = false

    for (const candidate of getCandidates(common, scientific)) {
      const result = await fetchSummary(candidate)
      if (result.kind === 'error') {
        hadTransientError = true
        continue
      }

      if (result.kind === 'hit' && result.data.extract) {
        const summary: WikiSummary = {
          title: result.data.title || common,
          extract: result.data.extract,
          imageUrl: extractImageUrl(result.data, 800),
          pageUrl: result.data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(common.replace(/ /g, '_'))}`,
        }
        summaryCache.set(cacheKey, summary)
        return summary
      }
    }

    if (!hadTransientError) {
      summaryCache.set(cacheKey, null)
    }
    return undefined
  })()

  summaryInFlight.set(cacheKey, lookupPromise)
  try {
    return await lookupPromise
  } finally {
    summaryInFlight.delete(cacheKey)
  }
}
