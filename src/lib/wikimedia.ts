/**
 * Fetch bird images and summaries from the Wikipedia REST API.
 * Uses species display names for lookup keys against the Wikipedia REST API.
 * No API key required.
 */
import { getDisplayName } from './utils'
import { fetchWithLocalAuthRetry } from './local-auth-fetch'

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

/** Shared cache for the raw REST API response -- populated once, used by both image and summary lookups. */
const restCache = new Map<string, RestSummary | null>()
const restInFlight = new Map<string, Promise<RestSummary | undefined>>()

/** Cache for wiki-title API lookups. */
const wikiTitleCache = new Map<string, { wikiTitle: string | null; common: string | null; scientific: string | null }>()

/** Fetch a Wikipedia page summary via the REST API. */
async function fetchSummary(title: string): Promise<FetchResult> {
  try {
    const encoded = encodeURIComponent(title.replace(/ /g, '_'))
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`,
      { headers: { 'Api-User-Agent': 'WingDex/1.0 (bird identification app)' } }
    )
    if (!res.ok) return res.status === 404 ? { kind: 'miss' } : { kind: 'error' }
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

function getLookupTitles(speciesName: string): string[] {
  const common = getCommonName(speciesName)
  const cacheKey = common.toLowerCase()
  const cached = wikiTitleCache.get(cacheKey)

  const candidates = cached
    ? [cached.wikiTitle, cached.common, cached.scientific, common]
    : [common]

  const unique: string[] = []
  const seen = new Set<string>()
  for (const title of candidates) {
    if (!title?.trim()) continue
    const key = title.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(title)
  }

  return unique
}

/** Fetch and cache taxonomy match from the server wiki-title API. */
async function ensureWikiTitleCached(speciesName: string): Promise<void> {
  const common = getCommonName(speciesName)
  const cacheKey = common.toLowerCase()
  if (wikiTitleCache.has(cacheKey)) return

  try {
    const res = await fetchWithLocalAuthRetry(`/api/species/wiki-title?name=${encodeURIComponent(speciesName)}`, { credentials: 'include' })
    if (res.ok) {
      const data = await res.json() as { wikiTitle: string | null; common: string | null; scientific: string | null }
      wikiTitleCache.set(cacheKey, data)
    } else {
      // Cache negative result to avoid refetching on every render
      wikiTitleCache.set(cacheKey, { wikiTitle: null, common: null, scientific: null })
    }
  } catch {
    // Cache negative result to avoid repeated fetches during transient failures
    wikiTitleCache.set(cacheKey, { wikiTitle: null, common: null, scientific: null })
  }
}

/**
 * Resolve the raw REST summary for a species, fetching at most once.
 * Both getWikimediaImage and getWikimediaSummary go through this so the
 * Wikipedia API is only called once per species.
 */
async function resolveRestSummary(speciesName: string): Promise<RestSummary | undefined> {
  const common = getCommonName(speciesName)
  const cacheKey = common.toLowerCase()

  await ensureWikiTitleCached(speciesName)

  if (restCache.has(cacheKey)) {
    return restCache.get(cacheKey) ?? undefined
  }

  const inFlight = restInFlight.get(cacheKey)
  if (inFlight) return inFlight

  const lookupPromise = (async (): Promise<RestSummary | undefined> => {
    const titles = getLookupTitles(speciesName)
    let sawError = false
    let fallbackHit: RestSummary | undefined

    for (const title of titles) {
      const result = await fetchSummary(title)
      if (result.kind === 'hit') {
        if (!fallbackHit) fallbackHit = result.data
        if (extractThumbnailUrl(result.data)) {
          restCache.set(cacheKey, result.data)
          return result.data
        }
        continue
      }
      if (result.kind === 'error') {
        sawError = true
      }
    }

    if (fallbackHit) {
      restCache.set(cacheKey, fallbackHit)
      return fallbackHit
    }

    if (!sawError) {
      restCache.set(cacheKey, null)
    }
    return undefined
  })()

  restInFlight.set(cacheKey, lookupPromise)
  try {
    return await lookupPromise
  } finally {
    restInFlight.delete(cacheKey)
  }
}

/**
 * Get a Wikimedia Commons thumbnail URL for a bird species.
 */
export async function getWikimediaImage(
  speciesName: string,
): Promise<string | undefined> {
  const data = await resolveRestSummary(speciesName)
  return data ? extractThumbnailUrl(data) : undefined
}

/**
 * Get Wikipedia summary text + image for a bird species.
 */
export async function getWikimediaSummary(
  speciesName: string
): Promise<WikiSummary | undefined> {
  const data = await resolveRestSummary(speciesName)
  if (!data?.extract) return undefined

  const common = getCommonName(speciesName)
  return {
    title: data.title || common,
    extract: data.extract,
    imageUrl: extractFullImageUrl(data),
    pageUrl: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent((data.title || common).replace(/ /g, '_'))}`,
  }
}
