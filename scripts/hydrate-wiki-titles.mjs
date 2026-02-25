#!/usr/bin/env node
/**
 * Hydrate taxonomy.json with pre-resolved Wikipedia article titles and thumbnail URLs.
 *
 * Step 1: Bulk-match via a single Wikidata SPARQL query (scientific name -> article title).
 * Step 2: For misses, try the Wikipedia REST API with the same strategy chain as wikimedia.ts.
 * Step 3: Fetch thumbnail URLs via the MediaWiki Action API (prop=pageimages, batched 50 at a time).
 * Step 4: Write taxonomy.json with
 *   [common, scientific, ebirdCode, wikiTitle | null, thumbnailPath | null].
 *
 * Thumbnail URLs come from the MediaWiki pageimages API at pithumbsize=330 (a standard
 * Wikimedia $wgThumbnailSteps size). The shared prefix
 * "https://upload.wikimedia.org/wikipedia/commons/" is stripped to save ~490KB.
 *
 * Run after any taxonomy update:
 *   node scripts/hydrate-wiki-titles.mjs
 */

import { readFileSync, writeFileSync } from 'fs'
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
 * Fetch all bird species from Wikidata that have an English Wikipedia article.
 * Returns Maps by scientific name and by article title (both lowercased).
 * Images are NOT sourced from Wikidata; they come from the Wikipedia REST API instead.
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

  console.log('Fetching bird species from Wikidata (SPARQL for titles)...')

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
    if (!bySci.has(sci)) {
      bySci.set(sci, { title, imageUrl: null })
    }
    const titleLower = title.toLowerCase()
    if (!byTitle.has(titleLower)) {
      byTitle.set(titleLower, { title, imageUrl: null })
    }
  }

  console.log(`  Got ${bySci.size} bird species with Wikipedia pages\n`)
  return { bySci, byTitle }
}

const WIKI_REST_MAX_RETRIES = 4

/** Adaptive throttle: increases when 429s are encountered, eases on success. */
let politeDelayMs = 400
const POLITE_DELAY_MIN = 400
const POLITE_DELAY_MAX = 5000

function bumpThrottle() {
  const prev = politeDelayMs
  politeDelayMs = Math.min(Math.round(politeDelayMs * 1.5), POLITE_DELAY_MAX)
  if (politeDelayMs !== prev) {
    console.log(`    Throttle raised to ${politeDelayMs}ms per request`)
  }
}

function easeThrottle() {
  if (politeDelayMs > POLITE_DELAY_MIN) {
    politeDelayMs = Math.max(Math.round(politeDelayMs * 0.75), POLITE_DELAY_MIN)
  }
}

/** Fetch a Wikipedia REST endpoint with exponential backoff on 429/5xx. */
async function fetchWithRetry(url, retries = WIKI_REST_MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      headers: { 'Api-User-Agent': 'WingDex/1.0 (taxonomy hydration)' },
    })
    if (res.ok) {
      easeThrottle()
      return res
    }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      if (res.status === 429) bumpThrottle()
      const backoffMs = Math.min(1000 * 2 ** attempt, 30_000)
      console.log(`    [${res.status}] ${url.split('/').pop()} - retry ${attempt}/${retries} in ${backoffMs / 1000}s`)
      await new Promise(r => setTimeout(r, backoffMs))
      continue
    }
    return res // non-retryable error or final attempt
  }
  return null // should not reach here
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
      const res = await fetchWithRetry(url)
      if (res?.ok) {
        const data = await res.json()
        if (data.extract) {
          return { title: data.title }
        }
      }
    } catch { /* skip */ }
    // Adaptive rate-limit politeness
    await new Promise(r => setTimeout(r, politeDelayMs))
  }
  return null
}

/**
 * Fetch image URL for a resolved title (used during title resolution as a side effect).
 * Returns { imageUrl, transient } so callers can distinguish "no image" from "request failed".
 */
async function fetchImageForTitle(title) {
  const encoded = encodeURIComponent(title.replace(/ /g, '_'))
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`
  try {
    const res = await fetchWithRetry(url)
    if (!res?.ok) return { imageUrl: null, transient: true }
    const data = await res.json()
    if (!data.extract) return { imageUrl: null, transient: false }
    return { imageUrl: data.originalimage?.source || null, transient: false }
  } catch {
    return { imageUrl: null, transient: true }
  }
}

const COMMONS_PREFIX = 'https://upload.wikimedia.org/wikipedia/commons/'
const THUMB_SIZE = 330

/**
 * Batch-fetch thumbnail URLs via the MediaWiki Action API (prop=pageimages).
 * Accepts up to 50 titles per request, returns CDN-cached thumbnail URLs
 * at a standard $wgThumbnailSteps size (330px).
 *
 * Returns a Map<title, thumbnailUrl | null>.
 */
async function batchFetchThumbnails(titles) {
  const result = new Map()
  const chunks = []
  for (let i = 0; i < titles.length; i += 50) {
    chunks.push(titles.slice(i, i + 50))
  }

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci]
    const params = new URLSearchParams({
      action: 'query',
      prop: 'pageimages',
      titles: chunk.map(t => t.replace(/ /g, '_')).join('|'),
      piprop: 'thumbnail',
      pithumbsize: String(THUMB_SIZE),
      format: 'json',
      formatversion: '2',
    })
    const url = `https://en.wikipedia.org/w/api.php?${params}`

    try {
      const res = await fetchWithRetry(url)
      if (!res?.ok) {
        // Mark all titles in this chunk as transient failures (don't cache)
        for (const t of chunk) result.set(t, undefined)
        continue
      }
      const data = await res.json()
      const pages = data.query?.pages || []

      // Build a lookup by normalized/redirected title
      const normalizeMap = new Map()
      for (const n of data.query?.normalized || []) {
        normalizeMap.set(n.to, n.from)
      }
      const redirectMap = new Map()
      for (const r of data.query?.redirects || []) {
        redirectMap.set(r.to, r.from)
      }

      // Track which input titles we've matched
      const matched = new Set()

      for (const page of pages) {
        const thumbUrl = page.thumbnail?.source || null

        // Find the input title that led to this page
        let inputTitle = page.title
        // Check redirects
        const redirectedFrom = redirectMap.get(page.title)
        if (redirectedFrom) {
          const normalizedFrom = normalizeMap.get(redirectedFrom)
          inputTitle = normalizedFrom || redirectedFrom
        } else {
          const normalizedFrom = normalizeMap.get(page.title)
          if (normalizedFrom) inputTitle = normalizedFrom
        }

        // Match back to original titles (case-insensitive with underscores)
        const inputKey = inputTitle.replace(/_/g, ' ')
        for (const t of chunk) {
          if (!matched.has(t) && t.toLowerCase() === inputKey.toLowerCase()) {
            result.set(t, thumbUrl)
            matched.add(t)
            break
          }
        }

        // Also try matching by page.title directly
        if (matched.size < chunk.length) {
          const pageKey = page.title.replace(/_/g, ' ')
          for (const t of chunk) {
            if (!matched.has(t) && t.toLowerCase() === pageKey.toLowerCase()) {
              result.set(t, thumbUrl)
              matched.add(t)
              break
            }
          }
        }
      }

      // Mark unmatched titles as null (no image)
      for (const t of chunk) {
        if (!result.has(t)) result.set(t, null)
      }
    } catch {
      for (const t of chunk) result.set(t, undefined)
    }

    await new Promise(r => setTimeout(r, politeDelayMs))

    if ((ci + 1) % 10 === 0 || ci === chunks.length - 1) {
      console.log(`  ... batch ${ci + 1}/${chunks.length} (${result.size} titles processed)`)
    }
  }

  return result
}

/**
 * Strip the shared Wikimedia Commons prefix from a URL to save space in taxonomy.json.
 * Returns the path after "https://upload.wikimedia.org/wikipedia/commons/" or null.
 */
function trimCommonsPrefix(url) {
  if (!url) return null
  if (url.startsWith(COMMONS_PREFIX)) return url.substring(COMMONS_PREFIX.length)
  return url // Keep full URL for non-Commons images (shouldn't happen)
}

async function main() {
  const taxonomy = JSON.parse(readFileSync(TAXONOMY_PATH, 'utf-8'))
  console.log(`Loaded ${taxonomy.length} species from taxonomy.json\n`)

  let bySci = new Map()
  let byTitle = new Map()
  let wikidataAvailable = false

  // --images-only: skip Wikidata + title fallback, re-fetch all images from Wikipedia
  if (IMAGES_ONLY) {
    const withTitle = taxonomy.filter(e => e[3]).length
    console.log(`Images-only mode: preserving existing titles (${withTitle}), re-fetching all image URLs.\n`)
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
  let remaining = []
  let apiHits = 0

  if (IMAGES_ONLY) {
    // Preserve titles, clear images so they all get re-fetched
    for (const entry of taxonomy) {
      updated.push([entry[0], entry[1], entry[2] || null, entry[3] || null, null])
    }
  } else {
    // Helper to push a resolved entry (5-element tuple).
    // Element [4] (thumbnail) is null here; filled by the batch pageimages pass below.
    function pushResolved(common, scientific, ebirdCode, match) {
      updated.push([common, scientific, ebirdCode, match.title, null])
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

    // Pass 2: API fallback for misses (with retry sweeps)
    remaining = [...misses]
    const MAX_TITLE_RETRIES = 5

    for (let attempt = 1; attempt <= MAX_TITLE_RETRIES && remaining.length > 0; attempt++) {
      if (attempt > 1) {
        const waitSec = attempt * 10
        console.log(`\n  Title sweep ${attempt}/${MAX_TITLE_RETRIES}: ${remaining.length} remaining, waiting ${waitSec}s...`)
        await new Promise(r => setTimeout(r, waitSec * 1000))
      }

      const stillMissing = []
      for (let i = 0; i < remaining.length; i++) {
        const { common, scientific, ebirdCode, index } = remaining[i]
        const result = await tryWikipediaApi(common, scientific)
        if (result) {
          updated[index] = [common, scientific, ebirdCode, result.title, null]
          apiHits++
        } else {
          stillMissing.push(remaining[i])
        }
        if ((i + 1) % 50 === 0) {
          console.log(`  ... checked ${i + 1}/${remaining.length} (${apiHits} total API hits)`)
        }
      }
      remaining = stillMissing
      console.log(`  Title sweep ${attempt}: ${remaining.length} still missing`)
    }
  }

  // --- Batch thumbnail fetch via MediaWiki pageimages API ---
  console.log('\nFetching thumbnail URLs via MediaWiki pageimages API (batched, 50/request)...')
  const titlesToFetch = [...new Set(updated.filter(e => e[3]).map(e => e[3]))]
  console.log(`  ${titlesToFetch.length} unique titles to fetch thumbnails for`)

  let thumbnailsFound = 0
  let transientMisses = 0
  const MAX_THUMB_SWEEPS = 3

  // Build title -> thumbnail URL map with retry sweeps
  const titleThumbMap = new Map()

  for (let sweep = 1; sweep <= MAX_THUMB_SWEEPS; sweep++) {
    const needsFetch = titlesToFetch.filter(t => !titleThumbMap.has(t))
    if (needsFetch.length === 0) break

    if (sweep > 1) {
      const waitSec = sweep * 15
      console.log(`\n  Thumbnail sweep ${sweep}/${MAX_THUMB_SWEEPS}: ${needsFetch.length} remaining, waiting ${waitSec}s...`)
      await new Promise(r => setTimeout(r, waitSec * 1000))
    }

    const batchResult = await batchFetchThumbnails(needsFetch)
    let sweepTransient = 0

    for (const [title, thumbUrl] of batchResult) {
      if (thumbUrl === undefined) {
        // Transient failure, retry next sweep
        sweepTransient++
      } else {
        titleThumbMap.set(title, thumbUrl)
        if (thumbUrl) thumbnailsFound++
      }
    }
    transientMisses = sweepTransient
    console.log(`  Thumbnail sweep ${sweep}: ${thumbnailsFound} found, ${sweepTransient} transient failures`)
    if (sweepTransient === 0) break
  }

  // Apply thumbnail URLs to entries (trimming the shared prefix)
  for (let i = 0; i < updated.length; i++) {
    const title = updated[i][3]
    if (title && titleThumbMap.has(title)) {
      updated[i][4] = trimCommonsPrefix(titleThumbMap.get(title))
    } else if (title && !titleThumbMap.has(title)) {
      updated[i][4] = null // transient failure, leave null
    }
  }

  const totalHits = taxonomy.length - misses.length + apiHits
  const withImages = updated.filter(e => e[4]).length
  const noImageDefinitive = updated.filter(e => e[3] && !e[4] && titleThumbMap.has(e[3])).length
  console.log(`\n--- Results ---`)
  console.log(`${totalHits}/${taxonomy.length} species hydrated (${((totalHits / taxonomy.length) * 100).toFixed(1)}%)`)
  console.log(`${withImages}/${taxonomy.length} species have thumbnail URLs (${((withImages / taxonomy.length) * 100).toFixed(1)}%)`)
  if (noImageDefinitive > 0) {
    console.log(`${noImageDefinitive} species have a Wikipedia page but no image on that page`)
  }
  if (transientMisses > 0) {
    console.log(`${transientMisses} thumbnail fetches still failing after all sweeps (transient errors)`)
  }
  if (remaining.length > 0) {
    console.log(`${remaining.length} species have no Wikipedia match (will use null):`)
    for (const { common, scientific } of remaining) {
      console.log(`  x ${common} (${scientific})`)
    }
  }

  // Write back, compact JSON (one line per entry for reasonable diffs)
  const json = '[\n' + updated.map(e => JSON.stringify(e)).join(',\n') + '\n]\n'
  writeFileSync(TAXONOMY_PATH, json)
  console.log(`\nWrote updated taxonomy.json (5-element tuples, prefix-trimmed thumbnail paths)`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
