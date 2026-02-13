/**
 * Local eBird taxonomy search & normalization.
 *
 * The bundled taxonomy.json is an array of [commonName, scientificName] pairs
 * covering all ~11 000 species recognized by eBird/Clements.
 */

import rawTaxonomy from './taxonomy.json'

export type TaxonEntry = { common: string; scientific: string }

// Build the flat list once on import
const taxonomy: TaxonEntry[] = (rawTaxonomy as [string, string][]).map(
  ([common, scientific]) => ({ common, scientific })
)

// Pre-compute lower-cased names for search
const lowerIndex = taxonomy.map(t => ({
  common: t.common.toLowerCase(),
  scientific: t.scientific.toLowerCase(),
}))

/**
 * Search the taxonomy by prefix / substring match.
 * Returns results ranked: prefix match on common name first,
 * then prefix on scientific name, then substring matches.
 */
export function searchSpecies(query: string, limit = 8): TaxonEntry[] {
  const q = query.toLowerCase().trim()
  if (!q) return []

  const prefixCommon: TaxonEntry[] = []
  const prefixScientific: TaxonEntry[] = []
  const substringCommon: TaxonEntry[] = []
  const substringScientific: TaxonEntry[] = []

  for (let i = 0; i < lowerIndex.length; i++) {
    const lc = lowerIndex[i]
    if (lc.common.startsWith(q)) {
      prefixCommon.push(taxonomy[i])
    } else if (lc.scientific.startsWith(q)) {
      prefixScientific.push(taxonomy[i])
    } else if (lc.common.includes(q)) {
      substringCommon.push(taxonomy[i])
    } else if (lc.scientific.includes(q)) {
      substringScientific.push(taxonomy[i])
    }

    // Early exit once we have plenty of results
    if (
      prefixCommon.length + prefixScientific.length +
      substringCommon.length + substringScientific.length >= limit * 3
    ) break
  }

  return [
    ...prefixCommon,
    ...prefixScientific,
    ...substringCommon,
    ...substringScientific,
  ].slice(0, limit)
}

/**
 * Find the single best taxonomy match for a species string.
 * Handles AI-style names like "Common Kingfisher (Alcedo atthis)".
 * Returns null if no reasonable match is found.
 */
export function findBestMatch(name: string): TaxonEntry | null {
  if (!name) return null

  const raw = name.trim()

  // Try exact match on common name first
  const exactCommon = taxonomy.find(
    t => t.common.toLowerCase() === raw.toLowerCase()
  )
  if (exactCommon) return exactCommon

  // If the name contains parenthesized scientific name, extract & try both
  const parenMatch = raw.match(/^(.+?)\s*\(([^)]+)\)\s*$/)
  if (parenMatch) {
    const commonPart = parenMatch[1].trim().toLowerCase()
    const sciPart = parenMatch[2].trim().toLowerCase()

    // Try scientific name first (more precise)
    const bySci = taxonomy.find(t => t.scientific.toLowerCase() === sciPart)
    if (bySci) return bySci

    // Then common name
    const byCommon = taxonomy.find(t => t.common.toLowerCase() === commonPart)
    if (byCommon) return byCommon
  }

  // Try exact match on scientific name
  const exactSci = taxonomy.find(
    t => t.scientific.toLowerCase() === raw.toLowerCase()
  )
  if (exactSci) return exactSci

  // Fuzzy: simple word-overlap scoring
  const words = raw.toLowerCase().split(/[\s\-()]+/).filter(Boolean)
  let bestScore = 0
  let bestEntry: TaxonEntry | null = null

  for (let i = 0; i < lowerIndex.length; i++) {
    const combined = lowerIndex[i].common + ' ' + lowerIndex[i].scientific
    let score = 0
    for (const w of words) {
      if (combined.includes(w)) score++
    }
    // Require at least half the words to match
    if (score > bestScore && score >= Math.ceil(words.length / 2)) {
      bestScore = score
      bestEntry = taxonomy[i]
    }
  }

  return bestEntry
}

/**
 * Normalize a species name to the canonical eBird common name.
 * Returns the original name if no match is found.
 */
export function normalizeSpeciesName(name: string): string {
  const match = findBestMatch(name)
  return match ? match.common : name
}

/** Total number of species in the taxonomy */
export const speciesCount = taxonomy.length
