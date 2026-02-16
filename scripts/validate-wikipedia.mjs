#!/usr/bin/env node
/**
 * Validate that all species in taxonomy.json have a Wikipedia page.
 *
 * Uses a single Wikidata SPARQL query to fetch all bird species with their
 * English Wikipedia page titles and scientific names. Then cross-references
 * against our taxonomy to find any species that are missing from Wikipedia.
 *
 * Usage:
 *   node scripts/validate-wikipedia.mjs [--limit N]
 *
 * Options:
 *   --limit N   Only check the first N species (for quick testing)
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TAXONOMY_PATH = resolve(__dirname, '../src/lib/taxonomy.json')
const REPORT_PATH = resolve(__dirname, '../wiki-validation-report.txt')

const args = process.argv.slice(2)
const limitIdx = args.indexOf('--limit')
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity

/**
 * Manual overrides for species whose eBird name doesn't match Wikipedia.
 * Must stay in sync with WIKI_OVERRIDES in src/lib/wikimedia.ts.
 */
const WIKI_OVERRIDES = {
  'Black-billed Cnemoscopus': 'Grey-hooded bush tanager',
  'Black-hooded Antthrush': 'Black-faced antthrush',
  'Chukar': 'Chukar partridge',
  'Gray-crowned Ground-Sparrow': 'White-eared ground sparrow',
  'Merlin': 'Merlin (bird)',
  'Mexican Squirrel-Cuckoo': 'Squirrel cuckoo',
  'Rose-bellied Chat': 'Rose-breasted chat',
}

/**
 * Fetch all bird species from Wikidata that have an English Wikipedia article.
 * Returns a Map of lowercased scientific name → Wikipedia page title.
 */
async function fetchWikidataBirds() {
  // SPARQL: all species in class Aves with an English Wikipedia sitelink
  // Fetches both scientific name and article title (which is often the common name)
  const sparql = `
    SELECT ?sciName ?articleTitle WHERE {
      ?taxon wdt:P31 wd:Q16521 ;          # instance of taxon
             wdt:P105 wd:Q7432 ;           # rank = species
             wdt:P171+ wd:Q5113 ;          # parent taxon includes Aves (birds)
             wdt:P225 ?sciName .           # scientific name
      ?article schema:about ?taxon ;
               schema:isPartOf <https://en.wikipedia.org/> ;
               schema:name ?articleTitle .
    }
  `

  console.log('Fetching bird species from Wikidata (single SPARQL query)...')
  const url = 'https://query.wikidata.org/sparql'
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/sparql-results+json',
      'User-Agent': 'BirdDex/1.0 (taxonomy validation; https://github.com/jlian/birddex)',
    },
    body: `query=${encodeURIComponent(sparql)}`,
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Wikidata SPARQL error ${res.status}: ${body.substring(0, 300)}`)
  }

  const data = await res.json()
  const results = data.results.bindings

  // Build two lookups:
  //   1. scientific name (lowercase) → Wikipedia title
  //   2. article title (lowercase) → Wikipedia title (matches common name lookups)
  const bySci = new Map()
  const byTitle = new Map()
  for (const row of results) {
    const sci = row.sciName.value.toLowerCase()
    const title = row.articleTitle.value
    bySci.set(sci, title)
    byTitle.set(title.toLowerCase(), title)
  }

  console.log(`  Got ${bySci.size} bird species with Wikipedia pages from Wikidata\n`)
  return { bySci, byTitle }
}

async function main() {
  const taxonomy = JSON.parse(readFileSync(TAXONOMY_PATH, 'utf-8'))
  const total = Math.min(taxonomy.length, limit)
  console.log(`Checking ${total} of ${taxonomy.length} species in taxonomy.json\n`)

  const { bySci, byTitle } = await fetchWikidataBirds()

  const misses = []
  let hitBySci = 0
  let hitByCommon = 0

  for (let i = 0; i < total; i++) {
    const common = taxonomy[i][0]
    const scientific = taxonomy[i][1]
    const sciLower = scientific.toLowerCase()
    const commonLower = common.toLowerCase()

    // Mirror the runtime lookup chain from wikimedia.ts:
    //   1. common name  2. scientific name  3. common + " bird"
    // Also try Gray↔Grey since eBird uses American "Gray" but Wikipedia often has "Grey"
    const greyVariant = commonLower.includes('gray')
      ? commonLower.replace(/gray/g, 'grey')
      : commonLower.includes('grey')
        ? commonLower.replace(/grey/g, 'gray')
        : null

    if (bySci.has(sciLower)) {
      hitBySci++
    } else if (byTitle.has(commonLower)) {
      hitByCommon++
    } else if (byTitle.has(commonLower + ' (bird)')) {
      hitByCommon++
    } else if (greyVariant && byTitle.has(greyVariant)) {
      hitByCommon++
    } else if (greyVariant && byTitle.has(greyVariant + ' (bird)')) {
      hitByCommon++
    } else {
      misses.push({ common, scientific })
    }
  }

  const hits = hitBySci + hitByCommon
  const lines = []
  const log = (msg = '') => { console.log(msg); lines.push(msg) }

  log(`${hits}/${total} species have Wikipedia pages (${((hits / total) * 100).toFixed(1)}%)`)
  log(`  Matched by scientific name: ${hitBySci}`)
  log(`  Matched by common name:     ${hitByCommon}`)

  if (misses.length === 0) {
    log('\n✅ All species resolve to a Wikipedia page!')
    writeFileSync(REPORT_PATH, lines.join('\n') + '\n')
    console.log(`\nReport written to ${REPORT_PATH}`)
    return
  }

  log(`\n⚠️  ${misses.length} species not found via Wikidata — verifying against Wikipedia API...\n`)

  // Second pass: check each miss against the actual Wikipedia REST API
  // This is the ground truth — mirrors exactly what the app does at runtime
  const trueMisses = []
  let apiHits = 0

  for (let i = 0; i < misses.length; i++) {
    const { common, scientific } = misses[i]
    const greyVariant = /gray/i.test(common)
      ? common.replace(/Gray/g, 'Grey').replace(/gray/g, 'grey')
      : /grey/i.test(common)
        ? common.replace(/Grey/g, 'Gray').replace(/grey/g, 'gray')
        : null

    // Same strategy chain as wikimedia.ts: override → common → scientific → common + " bird" → grey swap → dehyphenated
    const override = WIKI_OVERRIDES[common]
    const candidates = [override, common, scientific, `${common} bird`].filter(Boolean)
    if (greyVariant) candidates.push(greyVariant)
    // eBird uses hyphens (Storm-Petrel, Fish-Owl) but Wikipedia often doesn't (storm petrel, fish owl)
    const dehyphenated = common.replace(/-/g, ' ')
    if (dehyphenated !== common) {
      candidates.push(dehyphenated)
      candidates.push(`${dehyphenated} bird`)
    }

    let found = false
    let matchedVia = ''
    for (const candidate of candidates) {
      const encoded = encodeURIComponent(candidate.replace(/ /g, '_'))
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`
      try {
        const res = await fetch(url, {
          headers: { 'Api-User-Agent': 'BirdDex/1.0 (taxonomy validation)' },
        })
        if (res.ok) {
          const data = await res.json()
          if (data.extract) {
            found = true
            matchedVia = candidate
            break
          }
        }
      } catch {}
      // Small delay to be polite to Wikipedia
      await new Promise(r => setTimeout(r, 100))
    }

    if (found) {
      apiHits++
      log(`  ✓ ${common} — found via "${matchedVia}"`)
    } else {
      trueMisses.push({ common, scientific })
    }

    // Progress every 50
    if ((i + 1) % 50 === 0) {
      console.log(`  ... checked ${i + 1}/${misses.length}`)
    }
  }

  const totalHits = hits + apiHits
  log(`\n--- Final Results ---`)
  log(`${totalHits}/${total} species have Wikipedia pages (${((totalHits / total) * 100).toFixed(1)}%)`)
  log(`  Matched by Wikidata (scientific): ${hitBySci}`)
  log(`  Matched by Wikidata (common):     ${hitByCommon}`)
  log(`  Matched by Wikipedia API:         ${apiHits}`)

  if (trueMisses.length === 0) {
    log('\n✅ All species resolve to a Wikipedia page!')
  } else {
    log(`\n⚠️  ${trueMisses.length} species truly missing from Wikipedia:\n`)
    for (const miss of trueMisses) {
      log(`  ✗ ${miss.common} (${miss.scientific})`)
    }
  }

  writeFileSync(REPORT_PATH, lines.join('\n') + '\n')
  console.log(`\nReport written to ${REPORT_PATH}`)
  process.exit(1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
