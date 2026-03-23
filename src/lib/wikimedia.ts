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

type WikiLookupOptions = {
  wikiTitle?: string
}

/** Shared cache for the raw REST API response -- populated once, used by both image and summary lookups. */
const restCache = new Map<string, RestSummary | null>()
const restInFlight = new Map<string, Promise<RestSummary | undefined>>()

/** Cache for wiki-title API lookups. */
const wikiTitleCache = new Map<string, {
  wikiTitle: string | null
  common: string | null
  scientific: string | null
  thumbnailUrl?: string | null
}>()

// -- localStorage persistence for restCache ---------------------------
const STORAGE_KEY = 'wiki-rest-cache'
const MAX_CACHED_ENTRIES = 200

/** Hydrate restCache from localStorage on module load. */
function hydrateRestCache(): void {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const entries = JSON.parse(raw) as Array<[string, RestSummary | null]>
    for (const [key, value] of entries) restCache.set(key, value)
  } catch {
    // Corrupt or missing -- start fresh
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

/** Debounce-write restCache to localStorage (100ms). */
function schedulePersist(): void {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    try {
      // Keep only the most recent MAX_CACHED_ENTRIES (by insertion order)
      const entries = Array.from(restCache.entries())
      const trimmed = entries.length > MAX_CACHED_ENTRIES
        ? entries.slice(entries.length - MAX_CACHED_ENTRIES)
        : entries
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
    } catch {
      // Quota exceeded or unavailable -- silently skip
    }
  }, 100)
}

// Run hydration immediately on module load
if (typeof window !== 'undefined') hydrateRestCache()

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

function getLookupTitles(speciesName: string, preferredTitle?: string): string[] {
  const common = getCommonName(speciesName)
  const cacheKey = common.toLowerCase()
  const cached = wikiTitleCache.get(cacheKey)

  const candidates = [preferredTitle]
  if (cached) {
    candidates.push(cached.wikiTitle ?? undefined, cached.common ?? undefined, cached.scientific ?? undefined)
  }
  candidates.push(common)

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
async function resolveRestSummary(speciesName: string, options?: WikiLookupOptions): Promise<RestSummary | undefined> {
  const common = getCommonName(speciesName)
  const cacheKey = common.toLowerCase()

  if (!options?.wikiTitle) {
    await ensureWikiTitleCached(speciesName)
  }

  if (restCache.has(cacheKey)) {
    return restCache.get(cacheKey) ?? undefined
  }

  const inFlight = restInFlight.get(cacheKey)
  if (inFlight) return inFlight

  const lookupPromise = (async (): Promise<RestSummary | undefined> => {
    const titles = getLookupTitles(speciesName, options?.wikiTitle)
    let sawError = false
    let bestSummary: RestSummary | undefined

    for (const title of titles) {
      const result = await fetchSummary(title)
      if (result.kind === 'hit') {
        if (!bestSummary) bestSummary = result.data
        if (extractThumbnailUrl(result.data)) {
          // Merge first hit's text/page with this hit's image
          const merged = bestSummary === result.data
            ? result.data
            : { ...bestSummary, thumbnail: result.data.thumbnail, originalimage: result.data.originalimage }
          restCache.set(cacheKey, merged)
          schedulePersist()
          return merged
        }
        continue
      }
      if (result.kind === 'error') {
        sawError = true
      }
    }

    if (bestSummary) {
      restCache.set(cacheKey, bestSummary)
      schedulePersist()
      return bestSummary
    }

    if (!sawError) {
      restCache.set(cacheKey, null)
      schedulePersist()
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
  speciesName: string,
  options?: WikiLookupOptions,
): Promise<WikiSummary | undefined> {
  const data = await resolveRestSummary(speciesName, options)
  if (!data?.extract) return undefined

  const common = getCommonName(speciesName)
  return {
    title: data.title || common,
    extract: data.extract,
    imageUrl: extractFullImageUrl(data),
    pageUrl: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent((data.title || common).replace(/ /g, '_'))}`,
  }
}

// -- Gallery: multiple reference images from Wikipedia article -----------

/** Raw shape of an item from the Wikipedia media-list endpoint. */
type MediaListItem = {
  title: string
  type: string
  section_id?: number
  leadImage?: boolean
  showInGallery?: boolean
  srcset?: Array<{ src: string; scale: string }>
}

/** Patterns in filenames that indicate non-bird imagery (icons, maps, diagrams). */
const GALLERY_EXCLUDE_RE = /\.(svg|gif)$|Status_|range_map|distribution|map_of|map\.png|wikimedia-logo|commons-logo|wikidata-logo|cscr-|question_book|edit-clear|crystal_clear|ambox|folder_hexagonal/i

const galleryCache = new Map<string, string[]>()
const galleryInFlight = new Map<string, Promise<string[]>>()

function trimGalleryCache(): void {
  if (galleryCache.size <= MAX_CACHED_ENTRIES) return
  const keys = Array.from(galleryCache.keys())
  for (let i = 0; i < keys.length - MAX_CACHED_ENTRIES; i++) galleryCache.delete(keys[i])
}

/**
 * Get additional reference image URLs from a species' Wikipedia article.
 * Returns up to `limit` photo URLs (excluding the lead image, SVGs, maps, icons).
 */
export async function getWikimediaGallery(
  speciesName: string,
  options?: WikiLookupOptions & { limit?: number },
): Promise<string[]> {
  const limit = options?.limit ?? 6

  // Resolve the wiki title so we know which article to query
  if (!options?.wikiTitle) await ensureWikiTitleCached(speciesName)

  const common = getCommonName(speciesName)
  const cacheKey = common.toLowerCase()
  const cached = galleryCache.get(cacheKey)
  if (cached) return cached.slice(0, limit)

  const existing = galleryInFlight.get(cacheKey)
  if (existing) return existing.then(urls => urls.slice(0, limit))

  const promise = (async (): Promise<string[]> => {
    const titles = getLookupTitles(speciesName, options?.wikiTitle)
    for (const title of titles) {
      const urls = await fetchMediaList(title, limit)
      if (urls.length > 0) {
        galleryCache.set(cacheKey, urls)
        trimGalleryCache()
        return urls
      }
    }
    galleryCache.set(cacheKey, [])
    trimGalleryCache()
    return []
  })()

  galleryInFlight.set(cacheKey, promise)
  try { return await promise } finally { galleryInFlight.delete(cacheKey) }
}

async function fetchMediaList(title: string, limit: number): Promise<string[]> {
  try {
    const encoded = encodeURIComponent(title.replace(/ /g, '_'))
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/media-list/${encoded}`,
      { headers: { 'Api-User-Agent': 'WingDex/1.0 (bird identification app)' } },
    )
    if (!res.ok) return []
    const data = (await res.json()) as { items?: MediaListItem[] }
    if (!data.items) return []

    const urls: string[] = []
    for (const item of data.items) {
      if (item.type !== 'image') continue
      if (item.leadImage) continue
      if (item.showInGallery === false) continue
      // Limit to intro/infobox (section 0) and early body sections
      if (item.section_id !== undefined && item.section_id > 6) continue
      if (GALLERY_EXCLUDE_RE.test(item.title)) continue
      const src = item.srcset?.[0]?.src
      if (!src) continue
      urls.push(src.startsWith('//') ? `https:${src}` : src)
      if (urls.length >= limit) break
    }
    return urls
  } catch {
    return []
  }
}
