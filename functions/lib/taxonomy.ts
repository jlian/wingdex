import rawTaxonomy from '../../src/lib/taxonomy.json'

export type TaxonEntry = {
  common: string
  scientific: string
  ebirdCode?: string
  wikiTitle?: string
}

const taxonomy: TaxonEntry[] = (rawTaxonomy as unknown[]).map((entry: any) => ({
  common: entry[0],
  scientific: entry[1],
  ...(entry[2] ? { ebirdCode: entry[2] } : {}),
  ...(entry[3] ? { wikiTitle: entry[3] } : {}),
}))

const lowerIndex = taxonomy.map(taxon => ({
  common: taxon.common.toLowerCase(),
  scientific: taxon.scientific.toLowerCase(),
}))

const byCommonLower = new Map<string, TaxonEntry>()
const byCodeLower = new Map<string, TaxonEntry>()

for (const taxon of taxonomy) {
  byCommonLower.set(taxon.common.toLowerCase(), taxon)
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

  const exactCommon = taxonomy.find(taxon => taxon.common.toLowerCase() === raw.toLowerCase())
  if (exactCommon) return exactCommon

  const parenMatch = raw.match(/^(.+?)\s*\(([^)]+)\)\s*$/)
  if (parenMatch) {
    const commonPart = parenMatch[1].trim().toLowerCase()
    const scientificPart = parenMatch[2].trim().toLowerCase()

    const byScientific = taxonomy.find(taxon => taxon.scientific.toLowerCase() === scientificPart)
    if (byScientific) return byScientific

    const byCommon = taxonomy.find(taxon => taxon.common.toLowerCase() === commonPart)
    if (byCommon) return byCommon
  }

  const exactScientific = taxonomy.find(taxon => taxon.scientific.toLowerCase() === raw.toLowerCase())
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

export function getEbirdCode(commonName: string): string {
  const match = byCommonLower.get(commonName.toLowerCase())
  if (match?.ebirdCode) return match.ebirdCode

  const words = commonName.replace(/'/g, '').split(/[\s-]+/).filter(Boolean)
  const count = words.length

  if (count === 0) return ''

  let code: string

  if (count === 1) {
    code = words[0].slice(0, 6)
  } else if (count === 2) {
    code = words[0].slice(0, 3) + words[1].slice(0, 3)
  } else if (count === 3) {
    code = words[0].slice(0, 2) + words[1].slice(0, 1) + words[2].slice(0, 3)
  } else {
    const charsFromLast = Math.max(1, 7 - count)
    const prefixChars = 6 - charsFromLast
    code =
      words
        .slice(0, count - 1)
        .map(word => word[0])
        .join('')
        .slice(0, prefixChars) + words[count - 1].slice(0, charsFromLast)
  }

  return code.toLowerCase()
}

export function getSpeciesByCode(code: string): TaxonEntry | undefined {
  return byCodeLower.get(code.toLowerCase())
}

export const speciesCount = taxonomy.length
