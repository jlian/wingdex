/**
 * Fetch bird images and summaries from Wikipedia REST API.
 * Tries multiple search strategies: common name → scientific name → common name + " bird".
 * No API key required; rate-limited by User-Agent convention.
 */
import { getDisplayName, getScientificName } from './utils'

const imageCache = new Map<string, string>()
const summaryCache = new Map<string, WikiSummary>()

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
    const encoded = encodeURIComponent(title.replace(/ /g, '_'))
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`,
      { headers: { 'Api-User-Agent': 'BirdDex/1.0 (bird identification app)' } }
    )
    if (!res.ok && typeof res.status === 'number' && res.status > 0 && res.status !== 404) {
      console.warn(`[wikimedia] Unexpected summary response ${res.status} for "${title}"`)
    }
    if (!res.ok) return null
    return await res.json()
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
    return imageCache.get(cacheKey)
  }

  // Strategy 0: Check manual overrides for known mismatches
  const override = WIKI_OVERRIDES[common]
  let data = override ? await fetchSummary(override) : null
  let imageUrl = data ? extractImageUrl(data, size) : undefined

  // Strategy 1: Try dehyphenated variant first (Wikipedia often uses spaces)
  if (!imageUrl && dehyphenated) {
    data = await fetchSummary(dehyphenated)
    imageUrl = data ? extractImageUrl(data, size) : undefined
  }

  // Strategy 2: Try common name directly
  if (!imageUrl) {
    data = await fetchSummary(common)
    imageUrl = data ? extractImageUrl(data, size) : undefined
  }

  // Strategy 3: Try scientific name if common name had no image
  if (!imageUrl && scientific) {
    data = await fetchSummary(scientific)
    imageUrl = data ? extractImageUrl(data, size) : undefined
  }

  // Strategy 4: Try common name + " bird" (disambiguates e.g. "Robin")
  if (!imageUrl) {
    data = await fetchSummary(`${common} bird`)
    imageUrl = data ? extractImageUrl(data, size) : undefined
  }

  // Strategy 5: Try Gray↔Grey swap (eBird uses "Gray", Wikipedia often has "Grey")
  if (!imageUrl && /gray|grey/i.test(common)) {
    const swapped = common.replace(/Gray/g, 'Grey').replace(/gray/g, 'grey')
      === common ? common.replace(/Grey/g, 'Gray').replace(/grey/g, 'gray')
      : common.replace(/Gray/g, 'Grey').replace(/gray/g, 'grey')
    data = await fetchSummary(swapped)
    imageUrl = data ? extractImageUrl(data, size) : undefined
  }

  if (imageUrl) {
    imageCache.set(cacheKey, imageUrl)
  }
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
  const dehyphenated = common.includes('-') ? common.replace(/-/g, ' ') : undefined
  const cacheKey = common.toLowerCase()

  if (summaryCache.has(cacheKey)) {
    return summaryCache.get(cacheKey)
  }

  // Try override → common name → scientific name → common + " bird" → Gray↔Grey swap → dehyphenated
  const override = WIKI_OVERRIDES[common]
  const candidates = [override, dehyphenated, common, scientific, `${common} bird`].filter(Boolean) as string[]
  if (/gray|grey/i.test(common)) {
    const swapped = common.replace(/Gray/g, 'Grey').replace(/gray/g, 'grey')
      === common ? common.replace(/Grey/g, 'Gray').replace(/grey/g, 'gray')
      : common.replace(/Gray/g, 'Grey').replace(/gray/g, 'grey')
    candidates.push(swapped)
  }

  for (const candidate of [...new Set(candidates)]) {
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

  return undefined
}
