#!/usr/bin/env node
/**
 * Hydrate taxonomy.json with pre-resolved Wikipedia article titles and image URLs.
 *
 * Step 1: Bulk-match via a single Wikidata SPARQL query (scientific name -> article title + image).
 * Step 2: For misses, try the Wikipedia REST API with the same strategy chain as wikimedia.ts.
 * Step 3: Write taxonomy.json with
 *   [common, scientific, ebirdCode, wikiTitle | null, originalImageUrl | null].
 *
 * Thumbnail URLs are derived at runtime from the original URL (insert /thumb/ + append /{w}px-{file}).
 *
 * Run after any taxonomy update:
 *   node scripts/hydrate-wiki-titles.mjs
 */

import { readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TAXONOMY_PATH = resolve(__dirname, '../src/lib/taxonomy.json')
const WIKIDATA_URL = 'https://query.wikidata.org/sparql'
const WIKIDATA_MAX_RETRIES = 5
const IMAGES_ONLY = process.argv.includes('--images-only')

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
 * Convert a Wikimedia Commons filename to its upload.wikimedia.org URL.
 * The path uses the first 1 and 2 hex chars of the MD5 hash of the normalized filename.
 */
function commonsUrlFromFilename(rawFilename) {
  const filename = rawFilename.replace(/ /g, '_')
  const normalized = filename.charAt(0).toUpperCase() + filename.slice(1)
  const md5 = createHash('md5').update(normalized).digest('hex')
  const encoded = encodeURIComponent(normalized).replace(/%2C/g, ',').replace(/%3B/g, ';')
  return `https://upload.wikimedia.org/wikipedia/commons/${md5[0]}/${md5.substring(0, 2)}/${encoded}`
}

/**
 * Extract the filename from a Wikidata image URL (Special:FilePath/...).
 */
function extractFilenameFromWikidata(imageUrl) {
  try {
    const url = new URL(imageUrl)
    const lastSegment = url.pathname.split('/').pop()
    return lastSegment ? decodeURIComponent(lastSegment) : null
  } catch {
    return null
  }
}

/**
 * Fetch all bird species from Wikidata that have an English Wikipedia article.
 * Also fetches P18 (image) for bulk image URL resolution.
 * Returns Maps by scientific name and by article title (both lowercased).
 */
async function fetchWikidataBirds() {
  const sparql = `
    SELECT ?sciName ?articleTitle ?image WHERE {
      ?taxon wdt:P31 wd:Q16521 ;
             wdt:P105 wd:Q7432 ;
             wdt:P171+ wd:Q5113 ;
             wdt:P225 ?sciName .
      ?article schema:about ?taxon ;
               schema:isPartOf <https://en.wikipedia.org/> ;
               schema:name ?articleTitle .
      OPTIONAL { ?taxon wdt:P18 ?image . }
    }
  `

  console.log('Fetching bird species from Wikidata (SPARQL with images)...')

  let data = null
  let lastError = null

  for (let attempt = 1; attempt <= WIKIDATA_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(WIKIDATA_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/sparql-results+json',
          'User-Agent': 'WingDex/1.0 (taxonomy hydration; https://github.com/jlian/wingdex)',
        },
        body: `query=${encodeURIComponent(sparql)}`,
      })

      if (res.ok) {
        data = await res.json()
        break
      }

      const body = await res.text()
      const retryable = res.status >= 500 || res.status === 429
      lastError = new Error(`Wikidata SPARQL error ${res.status}: ${body.substring(0, 300)}`)

      if (!retryable || attempt === WIKIDATA_MAX_RETRIES) {
        throw lastError
      }

      const backoffMs = attempt * 5000
      console.log(`  attempt ${attempt}/${WIKIDATA_MAX_RETRIES} failed (${res.status}), retrying in ${backoffMs / 1000}s...`)
      await new Promise(resolve => setTimeout(resolve, backoffMs))
    } catch (error) {
      lastError = error
      if (attempt === WIKIDATA_MAX_RETRIES) {
        throw lastError
      }
      const backoffMs = attempt * 5000
      console.log(`  attempt ${attempt}/${WIKIDATA_MAX_RETRIES} failed (network), retrying in ${backoffMs / 1000}s...`)
      await new Promise(resolve => setTimeout(resolve, backoffMs))
    }
  }

  if (!data) {
    throw lastError || new Error('Wikidata SPARQL failed with unknown error')
  }

  const results = data.results.bindings

  const bySci = new Map()   // scientific name (lower) -> { title, imageUrl }
  const byTitle = new Map() // article title (lower) -> { title, imageUrl }

  for (const row of results) {
    const sci = row.sciName.value.toLowerCase()
    const title = row.articleTitle.value
    let imageUrl = null
    if (row.image) {
      const filename = extractFilenameFromWikidata(row.image.value)
      if (filename) imageUrl = commonsUrlFromFilename(filename)
    }
    // Prefer entries with images over those without
    const existing = bySci.get(sci)
    if (!existing || (!existing.imageUrl && imageUrl)) {
      bySci.set(sci, { title, imageUrl })
    }
    const titleLower = title.toLowerCase()
    const existingTitle = byTitle.get(titleLower)
    if (!existingTitle || (!existingTitle.imageUrl && imageUrl)) {
      byTitle.set(titleLower, { title, imageUrl })
    }
  }

  const withImages = [...bySci.values()].filter(v => v.imageUrl).length
  console.log(`  Got ${bySci.size} bird species with Wikipedia pages (${withImages} with images)\n`)
  return { bySci, byTitle }
}

/**
 * Try resolving a species against Wikipedia REST API.
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
        headers: { 'Api-User-Agent': 'WingDex/1.0 (taxonomy hydration)' },
      })
      if (res.ok) {
        const data = await res.json()
        if (data.extract) {
          return {
            title: data.title,
            originalImageUrl: data.originalimage?.source || null,
          }
        }
      }
    } catch { /* skip */ }
    // Rate-limit politeness
    await new Promise(r => setTimeout(r, 200))
  }
  return null
}

async function fetchImageForTitle(title) {
  const encoded = encodeURIComponent(title.replace(/ /g, '_'))
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`
  try {
    const res = await fetch(url, {
      headers: { 'Api-User-Agent': 'WingDex/1.0 (taxonomy hydration)' },
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data.extract) return null
    return data.originalimage?.source || null
  } catch {
    return null
  }
}

async function main() {
  const taxonomy = JSON.parse(readFileSync(TAXONOMY_PATH, 'utf-8'))
  console.log(`Loaded ${taxonomy.length} species from taxonomy.json\n`)

  let bySci = new Map()
  let byTitle = new Map()
  let wikidataAvailable = false

  if (IMAGES_ONLY) {
    console.log('Running in images-only mode: skipping Wikidata title matching and backfilling missing images by existing titles.\n')
  } else {
    try {
      const maps = await fetchWikidataBirds()
      bySci = maps.bySci
      byTitle = maps.byTitle
      wikidataAvailable = true
    } catch (error) {
      console.warn('Wikidata unavailable, falling back to REST-only mode for image backfill.')
      console.warn(error instanceof Error ? error.message : String(error))
      console.warn('Proceeding with existing titles in taxonomy.json.\n')
    }
  }

  const updated = []
  const misses = []

  // Helper to push a resolved entry (5-element tuple)
  function pushResolved(common, scientific, ebirdCode, match) {
    updated.push([common, scientific, ebirdCode, match.title, match.imageUrl || null])
  }

  // Pass 1: bulk match via Wikidata
  for (const entry of taxonomy) {
    const common = entry[0]
    const scientific = entry[1]
    const ebirdCode = entry[2] || null
    const sciLower = scientific.toLowerCase()
    const commonLower = common.toLowerCase()
    const existingTitle = entry[3] || null
    const existingImage = entry[4] || null

    if (!wikidataAvailable) {
      updated.push([common, scientific, ebirdCode, existingTitle, existingImage])
      if (!existingTitle) {
        misses.push({ common, scientific, ebirdCode, index: updated.length - 1 })
      }
      continue
    }

    // Check manual overrides first
    const override = WIKI_OVERRIDES[common]
    if (override && byTitle.has(override.toLowerCase())) {
      pushResolved(common, scientific, ebirdCode, byTitle.get(override.toLowerCase()))
      continue
    }

    // By scientific name (best match)
    if (bySci.has(sciLower)) {
      pushResolved(common, scientific, ebirdCode, bySci.get(sciLower))
      continue
    }

    // By article title matching common name
    if (byTitle.has(commonLower)) {
      pushResolved(common, scientific, ebirdCode, byTitle.get(commonLower))
      continue
    }

    // By article title matching common name + " (bird)" (disambiguation)
    if (byTitle.has(commonLower + ' (bird)')) {
      pushResolved(common, scientific, ebirdCode, byTitle.get(commonLower + ' (bird)'))
      continue
    }

    // Grey/Gray variant
    const greyVariant = commonLower.includes('gray')
      ? commonLower.replace(/gray/g, 'grey')
      : commonLower.includes('grey')
        ? commonLower.replace(/grey/g, 'gray')
        : null
    if (greyVariant && byTitle.has(greyVariant)) {
      pushResolved(common, scientific, ebirdCode, byTitle.get(greyVariant))
      continue
    }

    // Grey/Gray variant + "(bird)" disambiguation
    if (greyVariant && byTitle.has(greyVariant + ' (bird)')) {
      pushResolved(common, scientific, ebirdCode, byTitle.get(greyVariant + ' (bird)'))
      continue
    }

    // Dehyphenated
    if (common.includes('-')) {
      const dehyph = commonLower.replace(/-/g, ' ')
      if (byTitle.has(dehyph)) {
        pushResolved(common, scientific, ebirdCode, byTitle.get(dehyph))
        continue
      }
    }

    // Not found in Wikidata, queue for API fallback
    misses.push({ common, scientific, ebirdCode, index: updated.length })
    updated.push([common, scientific, ebirdCode, null, null]) // placeholder
  }

  if (wikidataAvailable) {
    console.log(`Wikidata matched: ${taxonomy.length - misses.length}/${taxonomy.length}`)
    console.log(`Remaining misses: ${misses.length}, checking Wikipedia API...\n`)
  } else {
    console.log(`Using existing taxonomy titles; ${misses.length} entries still missing titles, checking Wikipedia API...\n`)
  }

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
      const result = await tryWikipediaApi(common, scientific)
      if (result) {
        updated[index] = [common, scientific, ebirdCode, result.title, result.originalImageUrl]
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

  console.log('\nBackfilling images for resolved titles missing image URLs...')
  const missingImageIndexes = updated
    .map((entry, index) => ({ entry, index }))
    .filter(item => !!item.entry[3] && !item.entry[4])

  const titleImageCache = new Map()
  let backfilledImages = 0

  for (let i = 0; i < missingImageIndexes.length; i++) {
    const { index, entry } = missingImageIndexes[i]
    const title = entry[3]
    if (!title) continue

    let imageUrl
    if (titleImageCache.has(title)) {
      imageUrl = titleImageCache.get(title)
    } else {
      imageUrl = await fetchImageForTitle(title)
      titleImageCache.set(title, imageUrl)
      await new Promise(r => setTimeout(r, 120))
    }

    if (imageUrl) {
      updated[index] = [entry[0], entry[1], entry[2], title, imageUrl]
      backfilledImages++
    }

    if ((i + 1) % 200 === 0) {
      console.log(`  ... checked ${i + 1}/${missingImageIndexes.length} (${backfilledImages} image backfills)`)
    }
  }

  const totalHits = taxonomy.length - misses.length + apiHits
  const withImages = updated.filter(e => e[4]).length
  console.log(`\n--- Results ---`)
  console.log(`${totalHits}/${taxonomy.length} species hydrated (${((totalHits / taxonomy.length) * 100).toFixed(1)}%)`)
  console.log(`${withImages}/${taxonomy.length} species have image URLs (${((withImages / taxonomy.length) * 100).toFixed(1)}%)`)
  console.log(`${backfilledImages} image URLs backfilled from Wikipedia page summaries`)
  if (remaining.length > 0) {
    console.log(`${remaining.length} species have no Wikipedia match (will use null):`)
    for (const { common, scientific } of remaining) {
      console.log(`  x ${common} (${scientific})`)
    }
  }

  // Write back, compact JSON (one line per entry for reasonable diffs)
  const json = '[\n' + updated.map(e => JSON.stringify(e)).join(',\n') + '\n]\n'
  writeFileSync(TAXONOMY_PATH, json)
  console.log(`\nWrote updated taxonomy.json (5-element tuples)`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
