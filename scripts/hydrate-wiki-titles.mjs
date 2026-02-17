#!/usr/bin/env node
/**
 * Hydrate taxonomy.json with pre-resolved Wikipedia article titles.
 *
 * Step 1: Bulk-match via a single Wikidata SPARQL query (scientific name → article title).
 * Step 2: For misses, try the Wikipedia Action API with the same strategy chain as wikimedia.ts.
 * Step 3: Write taxonomy.json with [common, scientific, ebirdCode, wikiTitle | null].
 *
 * Run after any taxonomy update:
 *   node scripts/hydrate-wiki-titles.mjs
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TAXONOMY_PATH = resolve(__dirname, '../src/lib/taxonomy.json')

/** Manual overrides for species whose eBird name needs disambiguation on Wikipedia. */
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
 * Returns Maps by scientific name and by article title (both lowercased).
 */
async function fetchWikidataBirds() {
  const sparql = `
    SELECT ?sciName ?articleTitle WHERE {
      ?taxon wdt:P31 wd:Q16521 ;
             wdt:P105 wd:Q7432 ;
             wdt:P171+ wd:Q5113 ;
             wdt:P225 ?sciName .
      ?article schema:about ?taxon ;
               schema:isPartOf <https://en.wikipedia.org/> ;
               schema:name ?articleTitle .
    }
  `

  console.log('Fetching bird species from Wikidata (single SPARQL query)...')
  const res = await fetch('https://query.wikidata.org/sparql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/sparql-results+json',
      'User-Agent': 'BirdDex/1.0 (taxonomy hydration; https://github.com/jlian/birddex)',
    },
    body: `query=${encodeURIComponent(sparql)}`,
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Wikidata SPARQL error ${res.status}: ${body.substring(0, 300)}`)
  }

  const data = await res.json()
  const results = data.results.bindings

  const bySci = new Map()   // scientific name (lower) → article title
  const byTitle = new Map() // article title (lower) → article title

  for (const row of results) {
    const sci = row.sciName.value.toLowerCase()
    const title = row.articleTitle.value
    bySci.set(sci, title)
    byTitle.set(title.toLowerCase(), title)
  }

  console.log(`  Got ${bySci.size} bird species with Wikipedia pages\n`)
  return { bySci, byTitle }
}

/**
 * Try resolving a species against Wikipedia Action API.
 * Returns the Wikipedia article title if found, else null.
 */
async function tryWikipediaApi(common, scientific) {
  const override = WIKI_OVERRIDES[common]
  const dehyphenated = common.includes('-') ? common.replace(/-/g, ' ') : null
  const greyVariant = /gray/i.test(common)
    ? common.replace(/Gray/g, 'Grey').replace(/gray/g, 'grey')
    : /grey/i.test(common)
      ? common.replace(/Grey/g, 'Gray').replace(/grey/g, 'gray')
      : null

  const candidates = [override, common, scientific, `${common} bird`].filter(Boolean)
  if (greyVariant) candidates.push(greyVariant)
  if (dehyphenated) {
    candidates.push(dehyphenated)
    candidates.push(`${dehyphenated} bird`)
  }

  for (const candidate of candidates) {
    const encoded = encodeURIComponent(candidate.replace(/ /g, '_'))
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`
    try {
      const res = await fetch(url, {
        headers: { 'Api-User-Agent': 'BirdDex/1.0 (taxonomy hydration)' },
      })
      if (res.ok) {
        const data = await res.json()
        if (data.extract) {
          return data.title
        }
      }
    } catch { /* skip */ }
    // Rate-limit politeness
    await new Promise(r => setTimeout(r, 200))
  }
  return null
}

async function main() {
  const taxonomy = JSON.parse(readFileSync(TAXONOMY_PATH, 'utf-8'))
  console.log(`Loaded ${taxonomy.length} species from taxonomy.json\n`)

  const { bySci, byTitle } = await fetchWikidataBirds()

  const updated = []
  const misses = []

  // Pass 1: bulk match via Wikidata
  for (const entry of taxonomy) {
    const common = entry[0]
    const scientific = entry[1]
    const ebirdCode = entry[2] || null
    const sciLower = scientific.toLowerCase()
    const commonLower = common.toLowerCase()

    // Check manual overrides first
    const override = WIKI_OVERRIDES[common]
    if (override && byTitle.has(override.toLowerCase())) {
      updated.push([common, scientific, ebirdCode, byTitle.get(override.toLowerCase())])
      continue
    }

    // By scientific name (best match)
    if (bySci.has(sciLower)) {
      updated.push([common, scientific, ebirdCode, bySci.get(sciLower)])
      continue
    }

    // By article title matching common name
    if (byTitle.has(commonLower)) {
      updated.push([common, scientific, ebirdCode, byTitle.get(commonLower)])
      continue
    }

    // By article title matching common name + " (bird)" (disambiguation)
    if (byTitle.has(commonLower + ' (bird)')) {
      updated.push([common, scientific, ebirdCode, byTitle.get(commonLower + ' (bird)')])
      continue
    }

    // Grey/Gray variant
    const greyVariant = commonLower.includes('gray')
      ? commonLower.replace(/gray/g, 'grey')
      : commonLower.includes('grey')
        ? commonLower.replace(/grey/g, 'gray')
        : null
    if (greyVariant && byTitle.has(greyVariant)) {
      updated.push([common, scientific, ebirdCode, byTitle.get(greyVariant)])
      continue
    }

    // Grey/Gray variant + "(bird)" disambiguation
    if (greyVariant && byTitle.has(greyVariant + ' (bird)')) {
      updated.push([common, scientific, ebirdCode, byTitle.get(greyVariant + ' (bird)')])
      continue
    }

    // Dehyphenated
    if (common.includes('-')) {
      const dehyph = commonLower.replace(/-/g, ' ')
      if (byTitle.has(dehyph)) {
        updated.push([common, scientific, ebirdCode, byTitle.get(dehyph)])
        continue
      }
    }

    // Not found in Wikidata — queue for API fallback
    misses.push({ common, scientific, ebirdCode, index: updated.length })
    updated.push([common, scientific, ebirdCode, null]) // placeholder
  }

  console.log(`Wikidata matched: ${taxonomy.length - misses.length}/${taxonomy.length}`)
  console.log(`Remaining misses: ${misses.length} — checking Wikipedia API...\n`)

  // Pass 2: API fallback for misses (with retry for rate-limited requests)
  let remaining = [...misses]
  let apiHits = 0
  const MAX_RETRIES = 3

  for (let attempt = 1; attempt <= MAX_RETRIES && remaining.length > 0; attempt++) {
    if (attempt > 1) {
      const waitSec = attempt * 5
      console.log(`\n  Retry ${attempt}/${MAX_RETRIES}: ${remaining.length} remaining, waiting ${waitSec}s...`)
      await new Promise(r => setTimeout(r, waitSec * 1000))
    }

    const stillMissing = []
    for (let i = 0; i < remaining.length; i++) {
      const { common, scientific, ebirdCode, index } = remaining[i]
      const title = await tryWikipediaApi(common, scientific)
      if (title) {
        updated[index] = [common, scientific, ebirdCode, title]
        apiHits++
      } else {
        stillMissing.push(remaining[i])
      }
      if ((i + 1) % 50 === 0) {
        console.log(`  ... checked ${i + 1}/${remaining.length} (${apiHits} total API hits)`)
      }
    }
    remaining = stillMissing
    console.log(`  Pass ${attempt}: ${remaining.length} still missing after API check`)
  }

  const totalHits = taxonomy.length - misses.length + apiHits
  console.log(`\n--- Results ---`)
  console.log(`${totalHits}/${taxonomy.length} species hydrated (${((totalHits / taxonomy.length) * 100).toFixed(1)}%)`)
  if (remaining.length > 0) {
    console.log(`${remaining.length} species have no Wikipedia match (will use null):`)
    for (const { common, scientific } of remaining) {
      console.log(`  ✗ ${common} (${scientific})`)
    }
  }

  // Write back — compact JSON (one line per entry for reasonable diffs)
  const json = '[\n' + updated.map(e => JSON.stringify(e)).join(',\n') + '\n]\n'
  writeFileSync(TAXONOMY_PATH, json)
  console.log(`\nWrote updated taxonomy.json`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
