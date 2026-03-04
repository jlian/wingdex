import rawTaxonomy from '../../src/lib/taxonomy.json'

/** Shared prefix stripped from thumbnail paths in taxonomy.json to save ~490 KB. */
const COMMONS_PREFIX = 'https://upload.wikimedia.org/wikipedia/commons/'

type TaxonEntry = {
  common: string
  scientific: string
  ebirdCode?: string
  wikiTitle?: string
  /** Path relative to COMMONS_PREFIX (e.g. "thumb/a/ab/Foo.jpg/330px-Foo.jpg"). */
  thumbnailPath?: string
}

const taxonomy: TaxonEntry[] = (rawTaxonomy as unknown[]).map((entry: any) => ({
  common: entry[0],
  scientific: entry[1],
  ...(entry[2] ? { ebirdCode: entry[2] } : {}),
  ...(entry[3] ? { wikiTitle: entry[3] } : {}),
  ...(entry[4] ? { thumbnailPath: entry[4] } : {}),
}))

const lowerIndex = taxonomy.map(taxon => ({
  common: taxon.common.toLowerCase(),
  scientific: taxon.scientific.toLowerCase(),
}))

const byCommonLower = new Map<string, TaxonEntry>()
const byScientificLower = new Map<string, TaxonEntry>()
const byCodeLower = new Map<string, TaxonEntry>()

for (const taxon of taxonomy) {
  byCommonLower.set(taxon.common.toLowerCase(), taxon)
  byScientificLower.set(taxon.scientific.toLowerCase(), taxon)
  if (taxon.ebirdCode) byCodeLower.set(taxon.ebirdCode.toLowerCase(), taxon)
}

export function getWikiTitle(commonName: string): string | undefined {
  return byCommonLower.get(commonName.toLowerCase())?.wikiTitle
}

export function searchSpecies(query: string, limit = 8): TaxonEntry[] {
  const q = query.toLowerCase().trim()
  if (!q) return []

  const prefixCommon: TaxonEntry[] = []
  const prefixScientific: TaxonEntry[] = []
  const substringCommon: TaxonEntry[] = []
  const substringScientific: TaxonEntry[] = []

  for (let index = 0; index < lowerIndex.length; index++) {
    const current = lowerIndex[index]

    if (current.common.startsWith(q)) {
      prefixCommon.push(taxonomy[index])
    } else if (current.scientific.startsWith(q)) {
      prefixScientific.push(taxonomy[index])
    } else if (current.common.includes(q)) {
      substringCommon.push(taxonomy[index])
    } else if (current.scientific.includes(q)) {
      substringScientific.push(taxonomy[index])
    }

    if (
      prefixCommon.length +
        prefixScientific.length +
        substringCommon.length +
        substringScientific.length >=
      limit * 3
    ) {
      break
    }
  }

  return [...prefixCommon, ...prefixScientific, ...substringCommon, ...substringScientific].slice(0, limit)
}

export function findBestMatch(name: string): TaxonEntry | null {
  if (!name) return null

  const raw = name.trim()
  const rawLower = raw.toLowerCase()

  const exactCommon = byCommonLower.get(rawLower)
  if (exactCommon) return exactCommon

  const parenMatch = raw.match(/^(.+?)\s*\(([^)]+)\)\s*$/)
  if (parenMatch) {
    const commonPart = parenMatch[1].trim().toLowerCase()
    const scientificPart = parenMatch[2].trim().toLowerCase()

    const byScientific = byScientificLower.get(scientificPart)
    if (byScientific) return byScientific

    const byCommon = byCommonLower.get(commonPart)
    if (byCommon) return byCommon
  }

  const exactScientific = byScientificLower.get(rawLower)
  if (exactScientific) return exactScientific

  const words = raw.toLowerCase().split(/[\s\-()]+/).filter(Boolean)
  let bestScore = 0
  let bestEntry: TaxonEntry | null = null

  for (let index = 0; index < lowerIndex.length; index++) {
    const combined = `${lowerIndex[index].common} ${lowerIndex[index].scientific}`
    let score = 0

    for (const word of words) {
      if (combined.includes(word)) score++
    }

    if (score > bestScore && score >= Math.ceil(words.length / 2)) {
      bestScore = score
      bestEntry = taxonomy[index]
    }
  }

  return bestEntry
}

export function normalizeSpeciesName(name: string): string {
  const match = findBestMatch(name)
  return match ? match.common : name
}

export function getEbirdCode(commonName: string): string {
  // Strip parenthesized scientific name if present, e.g. "Saffron Finch (Sicalis flaveola)" → "Saffron Finch"
  const name = commonName.split('(')[0].trim()

  const match = byCommonLower.get(name.toLowerCase())
  if (match?.ebirdCode) return match.ebirdCode
  return ''
}

export function getSpeciesByCode(code: string): TaxonEntry | undefined {
  return byCodeLower.get(code.toLowerCase())
}

export function getWikiMetadata(name: string): {
  wikiTitle?: string
  thumbnailUrl?: string
  common?: string
  scientific?: string
} {
  const match = findBestMatch(name)
  if (!match) return {}

  return {
    wikiTitle: match.wikiTitle,
    thumbnailUrl: match.thumbnailPath
      ? `${COMMONS_PREFIX}${match.thumbnailPath}`
      : undefined,
    common: match.common,
    scientific: match.scientific,
  }
}

export const speciesCount = taxonomy.length
