/**
 * Fetch bird images and summaries from the Wikipedia REST API.
 * Uses pre-resolved Wikipedia article titles from taxonomy.json (hydrated at build time
 * by scripts/hydrate-wiki-titles.mjs) for a single-fetch lookup per species.
 * No API key required.
 */
import { getDisplayName } from './utils'
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

/** Raw shape returned by the Wikipedia REST page/summary endpoint. */
type RestSummary = {
  title?: string
  extract?: string
  thumbnail?: { source: string }
  originalimage?: { source: string }
  content_urls?: { desktop?: { page?: string } }
}

type FetchResult =
  | { kind: 'hit'; data: RestSummary }
  | { kind: 'miss' }
  | { kind: 'error' }

/** Fetch a Wikipedia page summary via the REST API. */
async function fetchSummary(title: string): Promise<FetchResult> {
  try {
    const encoded = encodeURIComponent(title.replace(/ /g, '_'))
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`,
      { headers: { 'Api-User-Agent': 'BirdDex/1.0 (bird identification app)' } }
    )
    if (!res.ok) return { kind: 'miss' }
    const data = (await res.json()) as RestSummary
    if (!data.extract) return { kind: 'miss' }
    return { kind: 'hit', data }
  } catch {
    return { kind: 'error' }
  }
}

/** Extract thumbnail image URL (for list views). */
function extractThumbnailUrl(data: RestSummary): string | undefined {
  return data.thumbnail?.source ?? data.originalimage?.source
}

/** Extract full-resolution image URL (for detail views). */
function extractFullImageUrl(data: RestSummary): string | undefined {
  return data.originalimage?.source ?? data.thumbnail?.source
}

/** Extract the common name from a species string like "Northern Cardinal (Cardinalis cardinalis)" */
function getCommonName(speciesName: string): string {
  return getDisplayName(speciesName)
}

/**
 * Get a Wikimedia Commons thumbnail URL for a bird species.
 */
export async function getWikimediaImage(
  speciesName: string,
): Promise<string | undefined> {
  const common = getCommonName(speciesName)
  const cacheKey = common.toLowerCase()
  const wikiTitle = getWikiTitle(common)
  if (!wikiTitle) return undefined

  if (imageCache.has(cacheKey)) {
    const cached = imageCache.get(cacheKey)
    return cached ?? undefined
  }

  const inFlight = imageInFlight.get(cacheKey)
  if (inFlight) return inFlight

  const lookupPromise = (async (): Promise<string | undefined> => {
    const result = await fetchSummary(wikiTitle)
    const imageUrl = result.kind === 'hit' ? extractThumbnailUrl(result.data) : undefined

    if (imageUrl) {
      imageCache.set(cacheKey, imageUrl)
    } else if (result.kind !== 'error') {
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
 */
export async function getWikimediaSummary(
  speciesName: string
): Promise<WikiSummary | undefined> {
  const common = getCommonName(speciesName)
  const cacheKey = common.toLowerCase()
  const wikiTitle = getWikiTitle(common)
  if (!wikiTitle) return undefined

  if (summaryCache.has(cacheKey)) {
    const cached = summaryCache.get(cacheKey)
    return cached ?? undefined
  }

  const inFlight = summaryInFlight.get(cacheKey)
  if (inFlight) return inFlight

  const lookupPromise = (async (): Promise<WikiSummary | undefined> => {
    const result = await fetchSummary(wikiTitle)

    if (result.kind === 'hit' && result.data.extract) {
      const summary: WikiSummary = {
        title: result.data.title || common,
        extract: result.data.extract,
        imageUrl: extractFullImageUrl(result.data),
        pageUrl: result.data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(common.replace(/ /g, '_'))}`,
      }
      summaryCache.set(cacheKey, summary)
      return summary
    }

    if (result.kind !== 'error') {
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
