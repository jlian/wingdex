#!/usr/bin/env node
/**
 * Unified LLM fixture capture and benchmark tool.
 *
 * Modes:
 *   capture (default):
 *     node scripts/capture-llm-fixtures.mjs --model gpt-5.4-mini --reasoning none
 *
 *   benchmark (all 6 variants):
 *     node scripts/capture-llm-fixtures.mjs benchmark
 *
 *   analyze (compare captured variants):
 *     node scripts/capture-llm-fixtures.mjs analyze
 *
 *   promote (copy variant to golden baseline for replay tests):
 *     node scripts/capture-llm-fixtures.mjs promote gpt-5.4-mini-reasoning-none
 *
 * Calls Cloudflare AI Gateway (same as production) with production-matching
 * image resize logic. No shortcuts or simplified paths.
 *
 * Credentials: OPENAI_API_KEY, CF_ACCOUNT_ID, AI_GATEWAY_ID (from env or .dev.vars)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import sharp from 'sharp'
import { buildBirdIdPrompt, BIRD_ID_INSTRUCTIONS, BIRD_ID_SCHEMA } from '../functions/lib/bird-id-prompt.js'

// ── Constants ───────────────────────────────────────────────

const ROOT = import.meta.dirname ? join(import.meta.dirname, '..') : process.cwd()
const IMAGE_DIR = join(ROOT, 'src', 'assets', 'images')
const GOLDEN_DIR = join(ROOT, 'src', '__tests__', 'fixtures', 'llm-responses')
const VARIANT_DIR = join(ROOT, 'test-results', 'llm-variants')
const BENCHMARK_RUNS_DIR = join(ROOT, 'test-results', 'benchmark-runs')
const RESULTS_DIR = join(ROOT, 'test-results')
const RANGE_CELLS_DIR = join(ROOT, 'tmp', 'range-priors', 'cells')

const MAX_OUTPUT_TOKENS = 600
const RESIZE_MAX_DIM = 640
const JPEG_QUALITY = 70

const WEB_SEARCH_DOMAINS = [
  'ebird.org',
  'allaboutbirds.org',
  'en.wikipedia.org',
  'birdsoftheworld.org',
]

const BENCHMARK_VARIANTS = [
  { model: 'gpt-4.1-mini', reasoning: null },
  { model: 'gpt-5.4-mini', reasoning: 'none' },
  { model: 'gpt-5.4-mini', reasoning: 'low' },
  { model: 'gpt-5.4-mini', reasoning: 'medium' },
]

/** Number of capture runs per variant in benchmark mode. Picks median-accuracy run. */
const BENCHMARK_RUNS = 3

const TAXONOMY = JSON.parse(readFileSync(join(ROOT, 'src', 'lib', 'taxonomy.json'), 'utf8'))
const SCIENTIFIC_TO_COMMON = new Map(
  TAXONOMY.map(entry => [String(entry[1]).toLowerCase(), String(entry[0])])
)

// ── Taxonomy + Range Pipeline (mirrors bird-id.ts post-LLM steps) ───

// Build taxonomy lookup indexes (mirrors functions/lib/taxonomy.ts)
const byCommonLower = new Map()
const byScientificLower = new Map()
const byCodeLower = new Map()
for (const [common, scientific, ebirdCode, wikiTitle] of TAXONOMY) {
  const entry = { common, scientific, ebirdCode: ebirdCode || '', wikiTitle: wikiTitle || '' }
  byCommonLower.set(common.toLowerCase(), entry)
  byScientificLower.set(scientific.toLowerCase(), entry)
  if (ebirdCode) byCodeLower.set(ebirdCode.toLowerCase(), entry)
}

function findBestMatch(name) {
  if (!name) return null
  const raw = name.trim()
  const rawLower = raw.toLowerCase()

  const exactCommon = byCommonLower.get(rawLower)
  if (exactCommon) return exactCommon

  const parenMatch = raw.match(/^(.+?)\s*\(([^)]+)\)\s*$/)
  if (parenMatch) {
    const sci = byScientificLower.get(parenMatch[2].trim().toLowerCase())
    if (sci) return sci
    const com = byCommonLower.get(parenMatch[1].trim().toLowerCase())
    if (com) return com
  }

  const exactSci = byScientificLower.get(rawLower)
  if (exactSci) return exactSci

  // Word-matching fallback
  const words = raw.toLowerCase().split(/[\s\-()]+/).filter(Boolean)
  let bestScore = 0, bestEntry = null
  for (const [common, scientific] of TAXONOMY) {
    const combined = `${common.toLowerCase()} ${scientific.toLowerCase()}`
    let score = 0
    for (const w of words) { if (combined.includes(w)) score++ }
    if (score > bestScore && score >= Math.max(2, Math.ceil(words.length / 2))) {
      bestScore = score
      bestEntry = byCommonLower.get(common.toLowerCase())
    }
  }
  return bestEntry
}

// Range-prior lookup from local cell blobs (uses shared module)
import {
  lonLatToEqualEarth as _eeProj,
  xyToCell as _xyToCell,
  nearestNeighborCell as _nearNeighbor,
  parseCellBlob as _parseBlob,
  adjustConfidence as _adjustConf,
  RECORD_SIZE as RG_RECORD_SIZE,
} from '../functions/lib/range-adjust.js'

const CELLS_DIR = join(ROOT, 'tmp', 'range-priors', 'cells')
const RANGE_AVAILABLE = existsSync(CELLS_DIR)

function loadCellBlob(row, col) {
  const blobPath = join(CELLS_DIR, `${row}-${col}.bin.gz`)
  if (!existsSync(blobPath)) return null
  return gunzipSync(readFileSync(blobPath))
}

function lookupRangePriors(lat, lon, month, ebirdCodes) {
  if (!RANGE_AVAILABLE || ebirdCodes.length === 0) {
    return new Map(ebirdCodes.map(c => [c, { status: 'no-data' }]))
  }
  const { x, y } = _eeProj(lon, lat)
  const cell = _xyToCell(x, y)
  if (!cell) {
    return new Map(ebirdCodes.map(c => [c, { status: 'no-data' }]))
  }

  const data = loadCellBlob(cell.row, cell.col)
  if (!data) {
    return new Map(ebirdCodes.map(c => [c, { status: 'no-data' }]))
  }

  const speciesMap = _parseBlob(data, new Set(ebirdCodes))
  const results = new Map()
  const outOfRange = []

  for (const code of ebirdCodes) {
    const attrs = speciesMap.get(code)
    if (attrs) {
      results.set(code, { status: 'present', ...attrs })
    } else {
      outOfRange.push(code)
    }
  }

  // Neighbor blending
  if (outOfRange.length > 0) {
    const neighbor = _nearNeighbor(x, y, cell.row, cell.col)
    if (neighbor) {
      const nData = loadCellBlob(neighbor.row, neighbor.col)
      if (nData) {
        const nMap = _parseBlob(nData, new Set(outOfRange))
        for (const code of outOfRange) {
          const attrs = nMap.get(code)
          results.set(code, attrs ? { status: 'near-range', ...attrs } : { status: 'out-of-range' })
        }
      } else {
        for (const code of outOfRange) results.set(code, { status: 'out-of-range' })
      }
    } else {
      for (const code of outOfRange) results.set(code, { status: 'out-of-range' })
    }
  }

  return results
}

/**
 * Simulate the full server-side post-LLM pipeline on a fixture's raw candidates.
 * Returns the final candidate list as it would appear to the user.
 */
function simulatePipeline(fixture) {
  const rawCandidates = fixture.parsed?.candidates || []
  const ctx = fixture.context || {}

  // Step 1: Taxonomy grounding (mirrors bird-id.ts)
  let candidates = rawCandidates
    .map(c => {
      const name = c.commonName || c.species || ''
      const sci = c.scientificName || ''
      const lookupName = sci ? `${name} (${sci})` : name
      const match = findBestMatch(lookupName)
      if (!match) return null
      return {
        species: `${match.common} (${match.scientific})`,
        commonName: match.common,
        confidence: Number(c.confidence),
        ebirdCode: match.ebirdCode,
        plumage: c.plumage || null,
      }
    })
    .filter(c => c && Number.isFinite(c.confidence) && c.confidence >= 0.2)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5)

  // Step 2: Range-prior adjustment
  let rangeAdjusted = false
  if (ctx.lat != null && ctx.lon != null && RANGE_AVAILABLE) {
    const codes = candidates.map(c => c.ebirdCode).filter(Boolean)
    const priors = lookupRangePriors(ctx.lat, ctx.lon, ctx.month, codes)
    rangeAdjusted = [...priors.values()].some(r => r.status !== 'no-data')
    candidates = candidates.map(c => {
      const range = priors.get(c.ebirdCode) || { status: 'no-data' }
      return { ...c, confidence: _adjustConf(c.confidence, range, ctx.month, ctx.lat), rangeStatus: range.status }
    })
    // Re-filter after adjustment (might drop below 0.2)
    candidates = candidates
      .filter(c => c.confidence >= 0.2)
      .sort((a, b) => b.confidence - a.confidence)
  }

  return { candidates, rangeAdjusted }
}

// ── Canonical image set ─────────────────────────────────────

const IMAGES = [
  // Seattle / Pacific Northwest
  { file: 'American_goldfinch_in_maple_at_Union_Bay_Natural_Area.jpg', lat: 47.6543, lon: -122.2952, month: 10, location: 'Union Bay Natural Area, Seattle, WA', truth: 'American Goldfinch' },
  { file: "Anna's_hummingbird_in_Seattle_garden.jpg", lat: 47.6399, lon: -122.4039, month: 6, location: 'Seattle, WA', truth: "Anna's Hummingbird" },
  { file: 'Belted_kingfisher_above_Puget_Sound_Carkeek_Park.jpg', lat: 47.7117, lon: -122.3771, month: 7, location: 'Carkeek Park, Seattle, WA', truth: 'Belted Kingfisher' },
  { file: 'Cormorants_on_navigation_marker_Skagit_Bay.jpg', lat: 48.3918, lon: -122.4885, month: 6, location: 'Skagit Bay, WA', truth: 'Cormorant' },
  { file: 'Cormorants_on_rock_Monterey_Harbor_sunset.jpg', lat: 36.6002, lon: -121.8947, month: 8, location: 'Monterey Harbor, CA', truth: 'Cormorant' },
  { file: 'Dark-eyed_junco_in_foliage_Seattle_Arboretum.jpg', lat: 47.6399, lon: -122.2958, month: 10, location: 'Washington Park Arboretum, Seattle, WA', truth: 'Dark-eyed Junco' },
  { file: 'Great_blue_heron_roosting_at_Carkeek_Park.jpg', lat: 47.7117, lon: -122.3771, month: 7, location: 'Carkeek Park, Seattle, WA', truth: 'Great Blue Heron' },
  { file: 'Great_blue_heron_with_Mount_Baker_from_Drayton_Harbor.jpg', lat: 48.9784, lon: -122.7913, month: 9, location: 'Drayton Harbor, Blaine, WA', truth: 'Great Blue Heron' },
  { file: 'Gulls_on_picnic_tables_Seattle_waterfront.jpg', lat: 47.6062, lon: -122.3421, month: 7, location: 'Seattle Waterfront, WA', truth: 'Gull' },
  { file: 'Hairy_woodpecker_on_mossy_tree_Carkeek_Park.jpg', lat: 47.7117, lon: -122.3771, month: 6, location: 'Carkeek Park, Seattle, WA', truth: 'Hairy Woodpecker' },
  { file: 'Lesser_scaup_hen_on_Union_Bay_Natural_Area.jpg', lat: 47.6543, lon: -122.2952, month: 10, location: 'Union Bay Natural Area, Seattle, WA', truth: null },  // ambiguous female diving duck
  { file: 'Mallard_drake_on_Union_Bay_Natural_Area.jpg', lat: 47.6543, lon: -122.2952, month: 10, location: 'Union Bay Natural Area, Seattle, WA', truth: 'Mallard' },
  { file: 'Stellers_Jay_eating_cherries_Seattle_backyard.jpg', lat: 47.6399, lon: -122.4039, month: 5, location: 'Seattle, WA', truth: "Steller's Jay" },
  { file: 'Tufted_puffin_near_Smith_Island_Washington.jpg', lat: 48.3204, lon: -122.8352, month: 7, location: 'Smith Island, WA', truth: 'Tufted Puffin' },
  { file: 'Common_goldeneye_at_Discovery_Park_Seattle.jpeg', lat: 47.6600, lon: -122.4287, month: 0, location: 'Discovery Park, Seattle, WA', truth: null },  // multi-bird ambiguity (goldeneye vs gull)
  // Chicago / Midwest
  { file: 'Black-throated_blue_warbler_in_Chicago_park.jpg', lat: 41.9632, lon: -87.6342, month: 8, location: 'Montrose Point, Chicago, IL', truth: 'Black-throated Blue Warbler' },
  { file: 'Female_northern_cardinal_in_Chicago_park.jpg', lat: 41.9632, lon: -87.6342, month: 8, location: 'Chicago, IL', truth: 'Northern Cardinal' },
  { file: 'House_sparrow_bathing_in_mosaic_fountain_Park_Ridge.jpg', lat: 42.0089, lon: -87.8310, month: 8, location: 'Park Ridge, IL', truth: 'House Sparrow' },
  { file: 'Palm_warbler_on_Lake_Michigan_shore_Chicago.jpg', lat: 41.9632, lon: -87.6342, month: 8, location: 'Lake Michigan shore, Chicago, IL', truth: null },  // likely sparrow, not warbler
  { file: 'Sanderling_foraging_Lake_Michigan_Chicago.jpg', lat: 41.9632, lon: -87.6342, month: 8, location: 'Lake Michigan, Chicago, IL', truth: null },  // Sanderling vs Semipalmated Sandpiper ambiguous
  // Hawaii
  { file: 'Chukar_partridge_near_Haleakala_summit_Maui.jpg', lat: 20.7148, lon: -156.2502, month: 11, location: 'Haleakala, Maui, HI', truth: 'Chukar' },
  // Europe
  { file: 'Pigeons_near_Museumplein_Amsterdam.jpg', lat: 52.3581, lon: 4.8826, month: 11, location: 'Museumplein, Amsterdam, Netherlands', truth: 'Pigeon' },
  { file: 'Cormorant_on_mooring_post_Lake_Como.jpg', lat: 45.8097, lon: 9.0846, month: 8, location: 'Lake Como, Italy', truth: 'Cormorant' },
  // Asia
  { file: 'Geese_in_misty_rice_paddies_Dehua_Fujian.jpg', lat: 25.7, lon: 118.24, month: 0, location: 'Dehua, Fujian, China', truth: null },  // domestic geese not in eBird taxonomy
  { file: 'Common_kingfisher_at_Taipei_Zoo.jpeg', lat: 24.998, lon: 121.581, month: 11, location: 'Taipei Zoo, Taiwan', truth: 'Common Kingfisher' },
  // Edge cases (no ground truth)
  { file: 'AI_generated_ambiguous_bird.png', lat: 40.0, lon: -100.0, month: 5, location: 'Unknown (AI-generated test image)', truth: null },
  { file: 'Unknown_bird_no_GPS.jpeg', lat: undefined, lon: undefined, month: undefined, location: undefined, truth: null },
]

// ── Helpers ─────────────────────────────────────────────────

function parseDevVars() {
  const devVarsPath = join(ROOT, '.dev.vars')
  if (!existsSync(devVarsPath)) return {}
  const vars = {}
  for (const rawLine of readFileSync(devVarsPath, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const [key, ...rest] = line.split('=')
    vars[key.trim()] = rest.join('=').trim()
  }
  return vars
}

function resolveEnv() {
  const devVars = parseDevVars()
  const cfAccountId = process.env.CF_ACCOUNT_ID || devVars.CF_ACCOUNT_ID
  const aiGatewayId = process.env.AI_GATEWAY_ID || devVars.AI_GATEWAY_ID
  const apiUrl = process.env.FIXTURE_API_URL || (
    cfAccountId && aiGatewayId
      ? `https://gateway.ai.cloudflare.com/v1/${cfAccountId}/${aiGatewayId}/openai/responses`
      : ''
  )
  const token = process.env.OPENAI_API_KEY || devVars.OPENAI_API_KEY
  const cfAigToken = process.env.CF_AIG_TOKEN || devVars.CF_AIG_TOKEN
  return { apiUrl, token, cfAigToken }
}

function isReasoningModel(model) {
  const n = model.toLowerCase()
  return n.includes('gpt-5') || n.startsWith('o1') || n.startsWith('o3') || n.startsWith('o4')
}

function variantName(model, reasoning, webSearch) {
  const base = reasoning && reasoning !== 'none' ? `${model}-${reasoning}` : model
  return webSearch ? `${base}-websearch` : base
}

function variantDir(variant) {
  const dir = join(VARIANT_DIR, variant)
  mkdirSync(dir, { recursive: true })
  return dir
}

function canonicalizeParsed(parsed) {
  if (!parsed || !Array.isArray(parsed.candidates)) return parsed
  return {
    ...parsed,
    candidates: parsed.candidates.map(c => {
      const commonName = String(c?.commonName || c?.species || '').trim()
      const scientificName = String(c?.scientificName || '').trim()
      // Canonicalize common name via taxonomy if scientific name is known
      const canonical = scientificName
        ? SCIENTIFIC_TO_COMMON.get(scientificName.toLowerCase())
        : null
      return {
        ...c,
        commonName: canonical || commonName,
        scientificName,
      }
    }),
  }
}

function extractResponseText(payload) {
  // SDK convenience field (not present in raw HTTP responses)
  if (typeof payload?.output_text === 'string') return payload.output_text

  // Walk Responses API output items
  if (Array.isArray(payload?.output)) {
    for (const item of payload.output) {
      if (item?.type !== 'message' || !Array.isArray(item.content)) continue
      for (const part of item.content) {
        if (part?.type === 'output_text' && typeof part.text === 'string') return part.text
      }
    }
  }

  // Chat Completions fallback
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content

  return ''
}

function percentile(values, p) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

function timingStats(values) {
  if (values.length === 0) return { min: null, median: null, p95: null, max: null }
  return {
    min: Math.min(...values),
    median: percentile(values, 50),
    p95: percentile(values, 95),
    max: Math.max(...values),
  }
}

// ── Capture ─────────────────────────────────────────────────

async function captureOne(entry, model, reasoning, env, outDir, overwrite, webSearch = false) {
  const imgPath = join(IMAGE_DIR, entry.file)
  if (!existsSync(imgPath)) {
    console.warn(`  skip ${entry.file}: file not found`)
    return null
  }

  const key = entry.file.replace(/\.[^.]+$/, '')
  const outPath = join(outDir, `${key}.json`)
  if (!overwrite && existsSync(outPath)) {
    console.log(`  skip ${key}: exists`)
    return null
  }

  const imgBuf = readFileSync(imgPath)
  const sourceMeta = await sharp(imgBuf).metadata()
  const resizedBuf = await sharp(imgBuf)
    .rotate()
    .resize({ width: RESIZE_MAX_DIM, height: RESIZE_MAX_DIM, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer()
  const resizedMeta = await sharp(resizedBuf).metadata()
  const dataUrl = `data:image/jpeg;base64,${resizedBuf.toString('base64')}`

  const prompt = buildBirdIdPrompt(
    entry.lat != null && entry.lon != null ? { lat: entry.lat, lon: entry.lon } : undefined,
    entry.month,
  )

  // Medium/high reasoning burns tokens on thinking; give more budget
  const maxTokens = (reasoning === 'medium' || reasoning === 'high') ? 2400 : MAX_OUTPUT_TOKENS

  const body = {
    model,
    store: false,
    ...(isReasoningModel(model) ? { reasoning: { effort: reasoning || 'low' } } : {}),
    ...(isReasoningModel(model) ? {} : { temperature: 0.2, top_p: 1.0 }),
    max_output_tokens: maxTokens,
    instructions: BIRD_ID_INSTRUCTIONS,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          { type: 'input_image', image_url: dataUrl, detail: 'high' },
        ],
      },
    ],
    text: { format: BIRD_ID_SCHEMA },
    ...(webSearch ? {
      tools: [{ type: 'web_search', filters: { allowed_domains: WEB_SEARCH_DOMAINS } }],
      tool_choice: 'auto',
    } : {}),
  }

  const startedAt = Date.now()
  const res = await fetch(env.apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.token}`,
      'Content-Type': 'application/json',
      ...(env.cfAigToken ? { 'cf-aig-authorization': `Bearer ${env.cfAigToken}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const durationMs = Date.now() - startedAt

  if (!res.ok) {
    const errText = await res.text()
    console.error(`  FAIL ${entry.file}: HTTP ${res.status}, ${errText.substring(0, 200)}`)
    return null
  }

  const json = await res.json()
  const rawText = extractResponseText(json)
  const usage = json.usage || null
  let parsed = null
  try { parsed = JSON.parse(rawText) } catch {}
  const canonicalParsed = canonicalizeParsed(parsed)
  const rawResponse = canonicalParsed ? JSON.stringify(canonicalParsed) : rawText

  const fixture = {
    imageFile: entry.file,
    context: { lat: entry.lat, lon: entry.lon, month: entry.month, locationName: entry.location },
    rawResponse,
    parsed: canonicalParsed,
    model,
    requestConfig: {
      tokenParam: 'max_output_tokens',
      maxCompletionTokens: MAX_OUTPUT_TOKENS,
      reasoningEffort: reasoning || null,
      webSearch: webSearch || false,
      resizedBeforeSend: true,
      resizeMaxDim: RESIZE_MAX_DIM,
      jpegQuality: JPEG_QUALITY,
      sourceDimensions: { width: sourceMeta.width || null, height: sourceMeta.height || null },
      uploadedDimensions: { width: resizedMeta.width || null, height: resizedMeta.height || null },
    },
    usage,
    durationMs,
    capturedAt: new Date().toISOString(),
  }

  writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n')

  const top = canonicalParsed?.candidates?.[0]
  const topLabel = top ? `${top.commonName} (${top.scientificName})` : '?'
  console.log(`  ${key}: ${topLabel} (${top?.confidence || '?'}) ${durationMs}ms`)
  return durationMs
}

async function captureVariant(model, reasoning, env, overwrite, webSearch = false, runSuffix = '') {
  const baseVariant = variantName(model, reasoning, webSearch)
  const variant = runSuffix ? `${baseVariant}${runSuffix}` : baseVariant
  // Run dirs go to tmp; canonical dirs go to llm-responses
  const outDir = runSuffix
    ? (() => { const d = join(BENCHMARK_RUNS_DIR, variant); mkdirSync(d, { recursive: true }); return d })()
    : variantDir(variant)

  console.log(`\n── ${variant} ──\n`)
  const durations = []

  for (const entry of IMAGES) {
    const ms = await captureOne(entry, model, reasoning, env, outDir, overwrite, webSearch)
    if (typeof ms === 'number') durations.push(ms)
    await new Promise(r => setTimeout(r, 800))
  }

  if (durations.length > 0) {
    const stats = timingStats(durations)
    console.log(`\n  Timing (ms): min=${stats.min} median=${stats.median} p95=${stats.p95} max=${stats.max}`)
  }

  return { variant, durations }
}

// ── Analyze ─────────────────────────────────────────────────

function loadVariantFixtures(variant) {
  const dir = join(VARIANT_DIR, variant)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')))
}

function analyzeVariants() {
  // Find all variant subdirectories
  const allEntries = existsSync(VARIANT_DIR) ? readdirSync(VARIANT_DIR, { withFileTypes: true }) : []
  const variantDirs = allEntries
    .filter(e => e.isDirectory() && e.name !== 'strong' && !e.name.includes('-run') && !e.name.includes('-websearch'))
    .map(e => e.name)
    .sort()

  if (variantDirs.length === 0) {
    console.error('No variant directories found. Run capture first.')
    process.exitCode = 1
    return
  }

  if (!RANGE_AVAILABLE) {
    console.warn('Warning: tmp/range-priors/cells/ not found - pipeline accuracy will skip range adjustment')
  }

  // Build ground-truth map from IMAGES array (substring match, case-insensitive)
  const truthByFile = new Map(
    IMAGES.filter(img => img.truth).map(img => [img.file, img.truth])
  )

  function matchesTruth(species, truth) {
    return species.toLowerCase().includes(truth.toLowerCase())
  }

  function getTop1Name(fixture) {
    const top = fixture.parsed?.candidates?.[0]
    return top?.commonName || top?.species || ''
  }

  const rows = []
  const report = { analyzedAt: new Date().toISOString(), rangeDataAvailable: RANGE_AVAILABLE, variants: {} }
  const rawMisses = {}
  const pipelineMisses = {}

  for (const variant of variantDirs) {
    const fixtures = loadVariantFixtures(variant)
    if (fixtures.length === 0) continue

    const durations = fixtures.map(f => f.durationMs).filter(v => typeof v === 'number')
    const stats = timingStats(durations)
    const parseCount = fixtures.filter(f => f.parsed && Array.isArray(f.parsed.candidates)).length

    // ── Raw LLM accuracy (before pipeline) ──
    let rawCorrect = 0, rawComparable = 0
    const variantRawMisses = []
    for (const f of fixtures) {
      const truth = truthByFile.get(f.imageFile)
      if (!truth) continue
      const top1 = getTop1Name(f)
      if (!top1) continue
      rawComparable++
      if (matchesTruth(top1, truth)) { rawCorrect++ }
      else { variantRawMisses.push({ file: f.imageFile, truth, got: top1 }) }
    }
    rawMisses[variant] = variantRawMisses

    // ── Pipeline accuracy (taxonomy + range) ──
    let pipeCorrect = 0, pipeComparable = 0
    const variantPipeMisses = []
    for (const f of fixtures) {
      const truth = truthByFile.get(f.imageFile)
      if (!truth) continue
      const { candidates } = simulatePipeline(f)
      const top1 = candidates[0]?.commonName || ''
      if (!top1) continue
      pipeComparable++
      if (matchesTruth(top1, truth)) { pipeCorrect++ }
      else {
        const rangeInfo = candidates[0]?.rangeStatus ? ` [${candidates[0].rangeStatus}]` : ''
        variantPipeMisses.push({ file: f.imageFile, truth, got: `${top1}${rangeInfo}` })
      }
    }
    pipelineMisses[variant] = variantPipeMisses

    // Token usage stats
    const inputTokens = fixtures.map(f => f.usage?.input_tokens).filter(v => typeof v === 'number')
    const outputTokens = fixtures.map(f => f.usage?.output_tokens).filter(v => typeof v === 'number')
    const reasoningTokens = fixtures.map(f => f.usage?.output_tokens_details?.reasoning_tokens).filter(v => typeof v === 'number')

    const rawAccStr = rawComparable > 0 ? `${Math.round((rawCorrect / rawComparable) * 100)}%` : 'n/a'
    const pipeAccStr = pipeComparable > 0 ? `${Math.round((pipeCorrect / pipeComparable) * 100)}%` : 'n/a'

    rows.push({
      variant,
      medianMs: stats.median,
      p95Ms: stats.p95,
      rawAcc: rawAccStr,
      rawFrac: `${rawCorrect}/${rawComparable}`,
      pipeAcc: pipeAccStr,
      pipeFrac: `${pipeCorrect}/${pipeComparable}`,
      medianInput: percentile(inputTokens, 50),
      medianOutput: percentile(outputTokens, 50),
      medianReasoning: percentile(reasoningTokens, 50),
    })

    report.variants[variant] = {
      fixtureCount: fixtures.length,
      parseRate: parseCount / fixtures.length,
      timing: stats,
      rawAccuracy: { correct: rawCorrect, comparable: rawComparable, rate: rawComparable > 0 ? rawCorrect / rawComparable : null },
      pipelineAccuracy: { correct: pipeCorrect, comparable: pipeComparable, rate: pipeComparable > 0 ? pipeCorrect / pipeComparable : null },
      tokens: {
        medianInput: percentile(inputTokens, 50),
        medianOutput: percentile(outputTokens, 50),
        medianReasoning: percentile(reasoningTokens, 50),
        totalInput: inputTokens.reduce((s, v) => s + v, 0),
        totalOutput: outputTokens.reduce((s, v) => s + v, 0),
      },
      rawMisidentifications: variantRawMisses,
      pipelineMisidentifications: variantPipeMisses,
    }
  }

  // Print summary table
  console.log('\n=== Benchmark Analysis ===\n')
  console.log(`Range priors: ${RANGE_AVAILABLE ? 'available' : 'NOT available (pipeline = taxonomy only)'}`)
  const header = `| ${'Variant'.padEnd(30)} | Median ms | p95 ms | Raw Acc     | Pipeline Acc | In tok | Out tok | Reas tok |`
  const sep = `|${'-'.repeat(32)}|-----------|--------|-------------|--------------|--------|---------|----------|`
  console.log(header)
  console.log(sep)
  for (const r of rows) {
    const rawStr = `${r.rawAcc} (${r.rawFrac})`
    const pipeStr = `${r.pipeAcc} (${r.pipeFrac})`
    console.log(
      `| ${r.variant.padEnd(30)} | ${String(r.medianMs ?? '-').padStart(9)} | ${String(r.p95Ms ?? '-').padStart(6)} | ${rawStr.padStart(11)} | ${pipeStr.padStart(12)} | ${String(r.medianInput ?? '-').padStart(6)} | ${String(r.medianOutput ?? '-').padStart(7)} | ${String(r.medianReasoning ?? '-').padStart(8)} |`
    )
  }

  // Print pipeline misidentifications (the ones that matter)
  const anyPipeMisses = Object.values(pipelineMisses).some(m => m.length > 0)
  if (anyPipeMisses) {
    console.log('\n── Pipeline Misidentifications ──\n')
    for (const variant of variantDirs) {
      const m = pipelineMisses[variant]
      if (!m || m.length === 0) continue
      console.log(`${variant}:`)
      for (const miss of m) {
        const shortFile = miss.file.replace(/\.[^.]+$/, '').substring(0, 40)
        console.log(`  ${shortFile.padEnd(42)} truth: ${miss.truth.padEnd(24)} got: ${miss.got}`)
      }
      console.log()
    }
  }

  // Show where pipeline changed the outcome vs raw
  console.log('── Pipeline Impact (raw miss -> pipeline correct, or vice versa) ──\n')
  for (const variant of variantDirs) {
    const rm = new Set((rawMisses[variant] || []).map(m => m.file))
    const pm = new Set((pipelineMisses[variant] || []).map(m => m.file))
    const rescued = [...rm].filter(f => !pm.has(f))
    const hurt = [...pm].filter(f => !rm.has(f))
    if (rescued.length === 0 && hurt.length === 0) continue
    console.log(`${variant}:`)
    for (const f of rescued) console.log(`  + RESCUED: ${f.replace(/\.[^.]+$/, '').substring(0, 50)}`)
    for (const f of hurt) console.log(`  - HURT:    ${f.replace(/\.[^.]+$/, '').substring(0, 50)}`)
    console.log()
  }

  // Write report JSON
  mkdirSync(RESULTS_DIR, { recursive: true })
  const reportPath = join(RESULTS_DIR, 'benchmark-analysis.json')
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
  console.log(`Report written to ${reportPath}`)
}

// ── Promote ─────────────────────────────────────────────────

function promoteVariant(variant) {
  const srcDir = join(VARIANT_DIR, variant)
  if (!existsSync(srcDir)) {
    console.error(`Variant directory not found: ${srcDir}`)
    process.exitCode = 1
    return
  }

  const files = readdirSync(srcDir).filter(f => f.endsWith('.json')).sort()
  if (files.length === 0) {
    console.error(`No fixture files in ${srcDir}`)
    process.exitCode = 1
    return
  }

  mkdirSync(GOLDEN_DIR, { recursive: true })
  let promoted = 0
  for (const file of files) {
    const fixture = JSON.parse(readFileSync(join(srcDir, file), 'utf8'))

    // Run through the full pipeline to get the final candidate list
    const { candidates, rangeAdjusted } = simulatePipeline(fixture)

    // Build the golden fixture with pipeline-processed candidates
    const golden = {
      imageFile: fixture.imageFile,
      context: fixture.context,
      rawResponse: JSON.stringify({
        candidates: candidates.map(c => ({
          species: c.species,
          confidence: c.confidence,
          ...(c.plumage ? { plumage: c.plumage } : {}),
          ...(c.rangeStatus ? { rangeStatus: c.rangeStatus } : {}),
        })),
        multipleBirds: fixture.parsed?.multipleBirds ?? false,
      }),
      parsed: {
        candidates: candidates.map(c => ({
          species: c.species,
          confidence: c.confidence,
          ...(c.plumage ? { plumage: c.plumage } : {}),
          ...(c.rangeStatus ? { rangeStatus: c.rangeStatus } : {}),
        })),
        birdCenter: fixture.parsed?.birdCenter ?? null,
        birdSize: fixture.parsed?.birdSize ?? null,
        multipleBirds: fixture.parsed?.multipleBirds ?? false,
      },
      model: fixture.model,
      durationMs: fixture.durationMs,
      capturedAt: fixture.capturedAt,
      promotedFrom: variant,
      promotedAt: new Date().toISOString(),
      rangeAdjusted,
    }

    writeFileSync(join(GOLDEN_DIR, file), JSON.stringify(golden, null, 2) + '\n')
    promoted++
  }

  console.log(`Promoted ${promoted} fixtures from ${variant} (with pipeline simulation) to golden baseline`)
  console.log(`Range priors: ${RANGE_AVAILABLE ? 'applied' : 'NOT available (taxonomy only)'}`)
  console.log(`Path: ${GOLDEN_DIR}`)
}

// ── CLI ─────────────────────────────────────────────────────

function printHelp() {
  console.log(`Usage: node scripts/capture-llm-fixtures.mjs [mode] [options]

Modes:
  (default)           Capture fixtures for one model variant
  benchmark           Capture all ${BENCHMARK_VARIANTS.length} benchmark variants
  analyze             Compare all captured variants
  promote <variant>   Copy variant fixtures to golden baseline

Options (capture mode):
  --model <name>             Model to use (required for single capture)
  --reasoning <none|low|medium>  Reasoning effort (omit for non-reasoning models)
  --overwrite                Overwrite existing fixture files

Environment:
  OPENAI_API_KEY, CF_ACCOUNT_ID, AI_GATEWAY_ID (or .dev.vars)

Benchmark variants:
${BENCHMARK_VARIANTS.map(v => `  ${variantName(v.model, v.reasoning, v.webSearch)}`).join('\n')}

Examples:
  node scripts/capture-llm-fixtures.mjs --model gpt-5.4-mini --reasoning none
  node scripts/capture-llm-fixtures.mjs benchmark
  node scripts/capture-llm-fixtures.mjs analyze
  node scripts/capture-llm-fixtures.mjs promote gpt-5.4-mini
`)
}

function parseArgs(argv) {
  const args = { mode: 'capture', model: null, reasoning: null, overwrite: false, promoteTarget: null }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === 'benchmark') { args.mode = 'benchmark'; continue }
    if (arg === 'analyze') { args.mode = 'analyze'; continue }
    if (arg === 'promote') { args.mode = 'promote'; args.promoteTarget = argv[++i]; continue }
    if (arg === '--model') { args.model = argv[++i]; continue }
    if (arg === '--reasoning') { args.reasoning = argv[++i]; continue }
    if (arg === '--overwrite') { args.overwrite = true; continue }
    if (arg === '--help' || arg === '-h') { args.mode = 'help'; continue }
  }

  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.mode === 'help') { printHelp(); return }
  if (args.mode === 'analyze') { analyzeVariants(); return }
  if (args.mode === 'promote') {
    if (!args.promoteTarget) { console.error('Usage: promote <variant-name>'); process.exitCode = 1; return }
    promoteVariant(args.promoteTarget)
    return
  }

  // Capture and benchmark modes need API credentials
  const env = resolveEnv()
  if (!env.token) { console.error('OPENAI_API_KEY required (env or .dev.vars)'); process.exitCode = 1; return }
  if (!env.apiUrl) { console.error('CF_ACCOUNT_ID + AI_GATEWAY_ID required (or FIXTURE_API_URL)'); process.exitCode = 1; return }

  if (args.mode === 'benchmark') {
    console.log(`\nBenchmark: capturing ${BENCHMARK_VARIANTS.length} variants x ${BENCHMARK_RUNS} runs, ${IMAGES.length} images each\n`)

    const truthByFile = new Map(IMAGES.filter(img => img.truth).map(img => [img.file, img.truth]))

    for (const v of BENCHMARK_VARIANTS) {
      const baseVariant = variantName(v.model, v.reasoning, v.webSearch)
      const runResults = []

      for (let run = 1; run <= BENCHMARK_RUNS; run++) {
        const suffix = `-run${run}`
        console.log(`\n── ${baseVariant} run ${run}/${BENCHMARK_RUNS} ──`)
        await captureVariant(v.model, v.reasoning, env, true, v.webSearch || false, suffix)

        // Score this run (from tmp runs dir)
        const runDir = join(BENCHMARK_RUNS_DIR, `${baseVariant}${suffix}`)
        const runFiles = readdirSync(runDir).filter(f => f.endsWith('.json')).sort()
        const fixtures = runFiles.map(f => JSON.parse(readFileSync(join(runDir, f), 'utf8')))
        let correct = 0, comparable = 0
        for (const f of fixtures) {
          const truth = truthByFile.get(f.imageFile)
          if (!truth) continue
          const top = f.parsed?.candidates?.[0]?.commonName || ''
          if (!top) continue
          comparable++
          if (top.toLowerCase().includes(truth.toLowerCase())) correct++
        }
        const medianMs = percentile(fixtures.map(f => f.durationMs).filter(v => typeof v === 'number'), 50)
        runResults.push({ run, suffix, correct, comparable, medianMs })
        console.log(`  Run ${run}: ${correct}/${comparable} correct, median ${medianMs}ms`)
      }

      // Pick median-accuracy run (on ties, pick lower median latency)
      runResults.sort((a, b) => b.correct - a.correct || a.medianMs - b.medianMs)
      const best = runResults[Math.floor(runResults.length / 2)] // median by accuracy
      console.log(`\n  Best run for ${baseVariant}: run ${best.run} (${best.correct}/${best.comparable})`)

      // Copy best run from tmp to the canonical variant directory
      const srcDir = join(BENCHMARK_RUNS_DIR, `${baseVariant}${best.suffix}`)
      const dstDir = variantDir(baseVariant)
      const files = readdirSync(srcDir).filter(f => f.endsWith('.json'))
      for (const file of files) {
        copyFileSync(join(srcDir, file), join(dstDir, file))
      }
      console.log(`  Copied ${files.length} fixtures to ${baseVariant}/`)
    }

    console.log('\nAll variants captured. Run "analyze" to compare results.\n')
    return
  }

  // Single capture
  if (!args.model) { console.error('--model required (or use "benchmark" mode)'); printHelp(); process.exitCode = 1; return }
  await captureVariant(args.model, args.reasoning, env, args.overwrite)
}

main().catch(e => { console.error(e); process.exit(1) })
