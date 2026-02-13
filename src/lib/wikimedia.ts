/**
 * Fetch a public-domain bird image URL from Wikimedia Commons via the Wikipedia API.
 * Falls back gracefully to undefined if no image is found.
 *
 * Uses the Wikipedia REST API to get the page thumbnail for a species name.
 * No API key required; rate-limited by User-Agent convention.
 */

const imageCache = new Map<string, string | null>()

/**
 * Get a Wikimedia Commons thumbnail URL for a bird species.
 * @param speciesName - e.g. "Northern Cardinal (Cardinalis cardinalis)"
 * @param size - Desired width in pixels (default 300)
 */
export async function getWikimediaImage(
  speciesName: string,
  size = 300
): Promise<string | undefined> {
  // Normalize: use common name only (strip scientific name in parens)
  const commonName = speciesName.split('(')[0].trim()
  const cacheKey = commonName.toLowerCase()

  if (imageCache.has(cacheKey)) {
    return imageCache.get(cacheKey) ?? undefined
  }

  try {
    // Try Wikipedia REST API summary endpoint — returns page image
    const title = encodeURIComponent(commonName.replace(/ /g, '_'))
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${title}`,
      { headers: { 'User-Agent': 'BirdDex-App/1.0 (bird identification app)' } }
    )

    if (!res.ok) {
      imageCache.set(cacheKey, null)
      return undefined
    }

    const data = await res.json()

    // Prefer the thumbnail, scale to desired size
    let imageUrl: string | undefined
    if (data.thumbnail?.source) {
      // Wikipedia thumbnails use /XXXpx- in the URL — replace to get desired size
      imageUrl = data.thumbnail.source.replace(/\/\d+px-/, `/${size}px-`)
    } else if (data.originalimage?.source) {
      imageUrl = data.originalimage.source
    }

    imageCache.set(cacheKey, imageUrl ?? null)
    return imageUrl
  } catch {
    imageCache.set(cacheKey, null)
    return undefined
  }
}

/**
 * Pre-fetches images for a list of species in parallel.
 * Returns a map of speciesName → imageUrl.
 */
export async function prefetchBirdImages(
  speciesNames: string[]
): Promise<Map<string, string>> {
  const results = new Map<string, string>()
  const toFetch = speciesNames.filter(
    name => !imageCache.has(name.split('(')[0].trim().toLowerCase())
  )

  // Fetch in batches of 5 to be polite to Wikipedia
  for (let i = 0; i < toFetch.length; i += 5) {
    const batch = toFetch.slice(i, i + 5)
    const promises = batch.map(async name => {
      const url = await getWikimediaImage(name)
      if (url) results.set(name, url)
    })
    await Promise.all(promises)
  }

  // Also include cached results
  for (const name of speciesNames) {
    const cached = imageCache.get(name.split('(')[0].trim().toLowerCase())
    if (cached) results.set(name, cached)
  }

  return results
}
