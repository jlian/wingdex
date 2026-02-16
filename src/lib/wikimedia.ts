/**
 * Fetch bird images and summaries from Wikipedia Action API.
 * Tries multiple search strategies: common name → scientific name → common name + " bird".
 * No API key required; rate-limited by User-Agent convention.
 */
import { getDisplayName, getScientificName } from './utils'

const imageCache = new Map<string, string | null>()
const summaryCache = new Map<string, WikiSummary | null>()
const imageInFlight = new Map<string, Promise<string | undefined>>()
const summaryInFlight = new Map<string, Promise<WikiSummary | undefined>>()

/**
 * Manual overrides for species whose eBird common name doesn't match any Wikipedia article.
 * Covers taxonomic splits (Wikipedia still uses the pre-split name) and disambiguation
 * (e.g. "Merlin" → the bird, not the mythical figure). Sorted alphabetically by key.
 */
const WIKI_OVERRIDES: Record<string, string> = {
  'Black-billed Cnemoscopus': 'Grey-hooded bush tanager',
  'Black-hooded Antthrush': 'Black-faced antthrush',
  'Chukar': 'Chukar partridge',
  'Gray-crowned Ground-Sparrow': 'White-eared ground sparrow',
  'Merlin': 'Merlin (bird)',
  'Mexican Squirrel-Cuckoo': 'Squirrel cuckoo',
  'Rose-bellied Chat': 'Rose-breasted chat',
}

export interface WikiSummary {
  title: string
  extract: string
  imageUrl?: string
  pageUrl: string
}

/** Fetch a Wikipedia page summary, returns null on miss */
async function fetchSummary(title: string): Promise<{ thumbnail?: { source: string }; originalimage?: { source: string }; extract?: string; content_urls?: { desktop?: { page?: string } }; title?: string } | null> {
  try {
    const normalizedTitle = title.replace(/ /g, '_')
    const encodedTitle = encodeURIComponent(normalizedTitle)
    const res = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*&redirects=1&prop=extracts|pageimages|info&inprop=url&exintro=1&explaintext=1&piprop=thumbnail|original&pithumbsize=600&titles=${encodedTitle}`,
      { headers: { 'Api-User-Agent': 'BirdDex/1.0 (bird identification app)' } }
    )
    if (!res.ok && res.status !== 404) {
      console.warn(`[wikimedia] Unexpected summary response ${res.status} for "${title}"`)
      return null
    }
    if (!res.ok) return null
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
    if (!page || page.missing) return null

    return {
      title: page.title,
      extract: page.extract,
      thumbnail: page.thumbnail?.source ? { source: page.thumbnail.source } : undefined,
      originalimage: page.original?.source ? { source: page.original.source } : undefined,
      content_urls: page.fullurl ? { desktop: { page: page.fullurl } } : undefined,
    }
  } catch {
    return null
  }
}

/** Extract image URL from a Wikipedia summary response */
function extractImageUrl(data: NonNullable<Awaited<ReturnType<typeof fetchSummary>>>, _size: number): string | undefined {
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
 * Get a Wikimedia Commons thumbnail URL for a bird species.
 * Tries: common name → scientific name → common name + " bird"
 */
export async function getWikimediaImage(
  speciesName: string,
  size = 300
): Promise<string | undefined> {
  const { common, scientific } = parseSpeciesName(speciesName)
  const dehyphenated = common.includes('-') ? common.replace(/-/g, ' ') : undefined
  const cacheKey = common.toLowerCase()

  if (imageCache.has(cacheKey)) {
    const cached = imageCache.get(cacheKey)
    return cached ?? undefined
  }

  const inFlight = imageInFlight.get(cacheKey)
  if (inFlight) return inFlight

  const lookupPromise = (async (): Promise<string | undefined> => {
    // Strategy 0: Check manual overrides for known mismatches
    const override = WIKI_OVERRIDES[common]
    let data = override ? await fetchSummary(override) : null
    let imageUrl = data ? extractImageUrl(data, size) : undefined

    // Strategy 1: Try common name directly
    if (!imageUrl) {
      data = await fetchSummary(common)
      imageUrl = data ? extractImageUrl(data, size) : undefined
    }

    // Strategy 2: Try scientific name if common name had no image
    if (!imageUrl && scientific) {
      data = await fetchSummary(scientific)
      imageUrl = data ? extractImageUrl(data, size) : undefined
    }

    // Strategy 3: Try common name + " bird" (disambiguates e.g. "Robin")
    if (!imageUrl) {
      data = await fetchSummary(`${common} bird`)
      imageUrl = data ? extractImageUrl(data, size) : undefined
    }

    // Strategy 4: Try Gray↔Grey swap (eBird uses "Gray", Wikipedia often has "Grey")
    if (!imageUrl && /gray|grey/i.test(common)) {
      const swapped = common.replace(/Gray/g, 'Grey').replace(/gray/g, 'grey')
        === common ? common.replace(/Grey/g, 'Gray').replace(/grey/g, 'gray')
        : common.replace(/Gray/g, 'Grey').replace(/gray/g, 'grey')
      data = await fetchSummary(swapped)
      imageUrl = data ? extractImageUrl(data, size) : undefined
    }

    // Strategy 5: Try dehyphenated (eBird: "Storm-Petrel", Wikipedia: "storm petrel")
    if (!imageUrl && dehyphenated) {
      data = await fetchSummary(dehyphenated)
      imageUrl = data ? extractImageUrl(data, size) : undefined
    }

    imageCache.set(cacheKey, imageUrl ?? null)
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
 * Used for species detail views.
 */
export async function getWikimediaSummary(
  speciesName: string
): Promise<WikiSummary | undefined> {
  const { common, scientific } = parseSpeciesName(speciesName)
  const dehyphenated = common.includes('-') ? common.replace(/-/g, ' ') : undefined
  const cacheKey = common.toLowerCase()

  if (summaryCache.has(cacheKey)) {
    const cached = summaryCache.get(cacheKey)
    return cached ?? undefined
  }

  const inFlight = summaryInFlight.get(cacheKey)
  if (inFlight) return inFlight

  const lookupPromise = (async (): Promise<WikiSummary | undefined> => {
    // Try override → common name → scientific name → common + " bird" → Gray↔Grey swap → dehyphenated
    const override = WIKI_OVERRIDES[common]
    const candidates = [override, common, scientific, `${common} bird`].filter(Boolean) as string[]
    if (/gray|grey/i.test(common)) {
      const swapped = common.replace(/Gray/g, 'Grey').replace(/gray/g, 'grey')
        === common ? common.replace(/Grey/g, 'Gray').replace(/grey/g, 'gray')
        : common.replace(/Gray/g, 'Grey').replace(/gray/g, 'grey')
      candidates.push(swapped)
    }
    if (dehyphenated) {
      candidates.push(dehyphenated)
    }

    for (const candidate of candidates) {
      const data = await fetchSummary(candidate)
      if (data?.extract) {
        const summary: WikiSummary = {
          title: data.title || common,
          extract: data.extract,
          imageUrl: extractImageUrl(data, 800),
          pageUrl: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(common.replace(/ /g, '_'))}`,
        }
        summaryCache.set(cacheKey, summary)
        return summary
      }
    }

    summaryCache.set(cacheKey, null)
    return undefined
  })()

  summaryInFlight.set(cacheKey, lookupPromise)
  try {
    return await lookupPromise
  } finally {
    summaryInFlight.delete(cacheKey)
  }
}
