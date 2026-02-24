/**
 * Client-side taxonomic order lookup.
 * Maps species common names to their index in the eBird taxonomy,
 * which represents phylogenetic/family order.
 * Loaded lazily on first access to avoid impacting initial bundle.
 */

let orderMap: Map<string, number> | null = null

async function loadOrderMap(): Promise<Map<string, number>> {
  if (orderMap) return orderMap
  const raw = (await import('./taxonomy.json')).default as unknown[][]
  const map = new Map<string, number>()
  for (let i = 0; i < raw.length; i++) {
    const common = raw[i][0] as string
    map.set(common.toLowerCase(), i)
  }
  orderMap = map
  return map
}

/**
 * Returns the taxonomic order index for a species name.
 * Strips parenthesized scientific name if present.
 * Returns Number.MAX_SAFE_INTEGER for unknown species.
 */
export async function getSpeciesOrder(speciesName: string): Promise<number> {
  const map = await loadOrderMap()
  const display = speciesName.split('(')[0].trim().toLowerCase()
  return map.get(display) ?? Number.MAX_SAFE_INTEGER
}

/**
 * Build a synchronous order map from already-loaded data for bulk sorting.
 * Returns a function that maps speciesName -> order.
 */
export async function buildSyncOrderLookup(
  speciesNames: string[]
): Promise<(name: string) => number> {
  const map = await loadOrderMap()
  const cache = new Map<string, number>()
  for (const name of speciesNames) {
    const display = name.split('(')[0].trim().toLowerCase()
    cache.set(name, map.get(display) ?? Number.MAX_SAFE_INTEGER)
  }
  return (name: string) => cache.get(name) ?? Number.MAX_SAFE_INTEGER
}
