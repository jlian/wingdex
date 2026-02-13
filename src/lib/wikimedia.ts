/**
 * Fetch bird images and summaries from Wikipedia REST API.
 * Tries multiple search strategies: common name → scientific name → common name + " bird".
 * No API key required; rate-limited by User-Agent convention.
 */
import { getDisplayName, getScientificName } from './utils'

const imageCache = new Map<string, string | null>()
const summaryCache = new Map<string, WikiSummary | null>()

/**
 * Manual overrides for species whose eBird common name doesn't match any Wikipedia article.
 * These are typically recent taxonomic splits where Wikipedia still uses the pre-split name.
 */
const WIKI_OVERRIDES: Record<string, string> = {
  'Mexican Squirrel-Cuckoo': 'Squirrel cuckoo',
  'Black-hooded Antthrush': 'Black-faced antthrush',
  'Gray-crowned Ground-Sparrow': 'White-eared ground sparrow',
  'Rose-bellied Chat': 'Rose-breasted chat',
  'Black-billed Cnemoscopus': 'Grey-hooded bush tanager',
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
    const encoded = encodeURIComponent(title.replace(/ /g, '_'))
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`,
      { headers: { 'Api-User-Agent': 'BirdDex/1.0 (bird identification app)' } }
    )
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/** Extract image URL from a Wikipedia summary response */
function extractImageUrl(data: NonNullable<Awaited<ReturnType<typeof fetchSummary>>>, size: number): string | undefined {
  if (data.thumbnail?.source) {
    return data.thumbnail.source.replace(/\/\d+px-/, `/${size}px-`)
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
  const cacheKey = common.toLowerCase()

  if (imageCache.has(cacheKey)) {
    return imageCache.get(cacheKey) ?? undefined
  }

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
  if (!imageUrl && common.includes('-')) {
    const dehyphenated = common.replace(/-/g, ' ')
    data = await fetchSummary(dehyphenated)
    imageUrl = data ? extractImageUrl(data, size) : undefined
  }

  imageCache.set(cacheKey, imageUrl ?? null)
  return imageUrl
}

/**
 * Get Wikipedia summary text + image for a bird species.
 * Used for species detail views.
 */
export async function getWikimediaSummary(
  speciesName: string
): Promise<WikiSummary | undefined> {
  const { common, scientific } = parseSpeciesName(speciesName)
  const cacheKey = common.toLowerCase()

  if (summaryCache.has(cacheKey)) {
    return summaryCache.get(cacheKey) ?? undefined
  }

  // Try override → common name → scientific name → common + " bird" → Gray↔Grey swap → dehyphenated
  const override = WIKI_OVERRIDES[common]
  const candidates = [override, common, scientific, `${common} bird`].filter(Boolean) as string[]
  if (/gray|grey/i.test(common)) {
    const swapped = common.replace(/Gray/g, 'Grey').replace(/gray/g, 'grey')
      === common ? common.replace(/Grey/g, 'Gray').replace(/grey/g, 'gray')
      : common.replace(/Gray/g, 'Grey').replace(/gray/g, 'grey')
    candidates.push(swapped)
  }
  // eBird uses hyphens (Storm-Petrel, Fish-Owl) but Wikipedia often doesn't
  if (common.includes('-')) {
    candidates.push(common.replace(/-/g, ' '))
  }

  for (const candidate of candidates) {
    const data = await fetchSummary(candidate)
    if (data?.extract) {
      const summary: WikiSummary = {
        title: data.title || common,
        extract: data.extract,
        imageUrl: data.originalimage?.source || extractImageUrl(data, 800),
        pageUrl: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(common.replace(/ /g, '_'))}`,
      }
      summaryCache.set(cacheKey, summary)
      return summary
    }
  }

  summaryCache.set(cacheKey, null)
  return undefined
}
