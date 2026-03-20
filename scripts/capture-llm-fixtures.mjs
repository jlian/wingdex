#!/usr/bin/env node
/**
 * Capture real LLM responses for test fixtures.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-xxx CF_ACCOUNT_ID=... AI_GATEWAY_ID=... node scripts/capture-llm-fixtures.mjs
 *   FIXTURE_OVERWRITE=true node scripts/capture-llm-fixtures.mjs
 *
 * Reads images from src/assets/images/, sends each to the Cloudflare AI Gateway
 * vision API with the same prompt used in production, and writes the raw
 * response to src/__tests__/fixtures/llm-responses/<image-key>.json.
 *
 * Capture mirrors runtime behavior by resizing images before send.
 *
 * The fixture includes:
 *   - imageFile: original filename
 *   - context: GPS/month/location passed in the prompt
 *   - rawResponse: the raw LLM response string
 *   - parsed: the parsed JSON from the response
 *   - capturedAt: ISO timestamp
 *   - model: the model used
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import sharp from 'sharp'
import { buildBirdIdPrompt } from '../functions/lib/bird-id-prompt.js'

const TAXONOMY = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'src', 'lib', 'taxonomy.json'), 'utf8'))
const SCIENTIFIC_TO_COMMON = new Map(
  TAXONOMY.map(entry => [String(entry[1]).toLowerCase(), String(entry[0])])
)

function parseDevVars() {
  if (!existsSync('.dev.vars')) return {}

  const vars = {}
  const content = readFileSync('.dev.vars', 'utf8')
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const [key, ...rest] = line.split('=')
    vars[key.trim()] = rest.join('=').trim()
  }

  return vars
}

const DEV_VARS = parseDevVars()
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || DEV_VARS.CF_ACCOUNT_ID
const AI_GATEWAY_ID = process.env.AI_GATEWAY_ID || DEV_VARS.AI_GATEWAY_ID
const CF_AIG_TOKEN = process.env.CF_AIG_TOKEN || DEV_VARS.CF_AIG_TOKEN
const API_URL = process.env.FIXTURE_API_URL || (
  CF_ACCOUNT_ID && AI_GATEWAY_ID
    ? `https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${AI_GATEWAY_ID}/openai/chat/completions`
    : ''
)
const MODEL = process.env.FIXTURE_MODEL || 'gpt-4.1-mini'
const STRONG_MODEL = process.env.FIXTURE_STRONG_MODEL || 'gpt-5-mini'
const MODELS = process.env.FIXTURE_MODEL
  ? [MODEL] // explicit single model via env var
  : [MODEL, STRONG_MODEL] // default: both models
const TOKEN = process.env.OPENAI_API_KEY || DEV_VARS.OPENAI_API_KEY
if (!TOKEN) { console.error('OPENAI_API_KEY required'); process.exit(1) }
if (!API_URL) {
  console.error('CF_ACCOUNT_ID and AI_GATEWAY_ID required unless FIXTURE_API_URL is set')
  process.exit(1)
}

const FIXTURE_OVERWRITE = process.env.FIXTURE_OVERWRITE === 'true'
const FIXTURE_TIMING_ONLY = process.env.FIXTURE_TIMING_ONLY === 'true'
const MAX_COMPLETION_TOKENS = Number(process.env.FIXTURE_MAX_COMPLETION_TOKENS || 1400)
const RESIZE_MAX_DIM = Number(process.env.FIXTURE_RESIZE_MAX_DIM || 640)
const JPEG_QUALITY = Number(process.env.FIXTURE_JPEG_QUALITY || 70)

function shouldUseMaxCompletionTokens(model) {
  const normalized = model.toLowerCase()
  return normalized.includes('gpt-5') || normalized.startsWith('o1') || normalized.startsWith('o3') || normalized.startsWith('o4')
}

function withTokenLimit(model, maxTokens) {
  if (shouldUseMaxCompletionTokens(model)) {
    return { max_completion_tokens: maxTokens }
  }

  return { max_tokens: maxTokens }
}

function withSamplingOptions(model) {
  if (shouldUseMaxCompletionTokens(model)) {
    return {}
  }

  return {
    temperature: 0.2,
    top_p: 1.0,
  }
}

function withReasoningOptions(model) {
  if (model.toLowerCase().includes('gpt-5')) {
    return { reasoning_effort: 'low' }
  }

  return {}
}

function canonicalizeSpeciesLabel(species) {
  const label = String(species || '').trim()
  if (!label) return label

  const match = label.match(/^(.+?)\s*\(([^()]+)\)$/)
  if (!match) return label

  const scientific = match[2].trim()
  const canonicalCommon = SCIENTIFIC_TO_COMMON.get(scientific.toLowerCase())
  if (!canonicalCommon) return label

  return `${canonicalCommon} (${scientific})`
}

function canonicalizeParsed(parsed) {
  if (!parsed || !Array.isArray(parsed.candidates)) return parsed

  return {
    ...parsed,
    candidates: parsed.candidates.map(candidate => ({
      ...candidate,
      species: canonicalizeSpeciesLabel(candidate?.species),
    })),
  }
}

const FIXTURE_BASE_DIR = join(import.meta.dirname, '..', 'src', '__tests__', 'fixtures', 'llm-responses')

function fixtureDir(model) {
  // Fast model stays in the root dir for backward compat; strong goes in a subdirectory
  if (model === STRONG_MODEL) {
    const dir = join(FIXTURE_BASE_DIR, 'strong')
    mkdirSync(dir, { recursive: true })
    return dir
  }
  mkdirSync(FIXTURE_BASE_DIR, { recursive: true })
  return FIXTURE_BASE_DIR
}

// Canonical image set with context metadata
// GPS/month derived from EXIF data and the real eBird CSV export.
const IMAGES = [
  // ── Seattle / Pacific Northwest ──────────────────────────
  {
    file: 'American_goldfinch_in_maple_at_Union_Bay_Natural_Area.jpg',
    lat: 47.6543, lon: -122.2952, month: 10, location: 'Union Bay Natural Area, Seattle, WA',
  },
  {
    file: "Anna's_hummingbird_in_Seattle_garden.jpg",
    lat: 47.6399, lon: -122.4039, month: 6, location: 'Seattle, WA',
  },
  {
    file: 'Belted_kingfisher_above_Puget_Sound_Carkeek_Park.jpg',
    lat: 47.7117, lon: -122.3771, month: 7, location: 'Carkeek Park, Seattle, WA',
  },
  {
    file: 'Cormorants_on_navigation_marker_Skagit_Bay.jpg',
    lat: 48.3918, lon: -122.4885, month: 6, location: 'Skagit Bay, WA',
  },
  {
    file: 'Cormorants_on_rock_Monterey_Harbor_sunset.jpg',
    lat: 36.6002, lon: -121.8947, month: 8, location: 'Monterey Harbor, CA',
  },
  {
    file: 'Dark-eyed_junco_in_foliage_Seattle_Arboretum.jpg',
    lat: 47.6399, lon: -122.2958, month: 10, location: 'Washington Park Arboretum, Seattle, WA',
  },
  {
    file: 'Great_blue_heron_roosting_at_Carkeek_Park.jpg',
    lat: 47.7117, lon: -122.3771, month: 7, location: 'Carkeek Park, Seattle, WA',
  },
  {
    file: 'Great_blue_heron_with_Mount_Baker_from_Drayton_Harbor.jpg',
    lat: 48.9784, lon: -122.7913, month: 9, location: 'Drayton Harbor, Blaine, WA',
  },
  {
    file: 'Gulls_on_picnic_tables_Seattle_waterfront.jpg',
    lat: 47.6062, lon: -122.3421, month: 7, location: 'Seattle Waterfront, WA',
  },
  {
    file: 'Hairy_woodpecker_on_mossy_tree_Carkeek_Park.jpg',
    lat: 47.7117, lon: -122.3771, month: 6, location: 'Carkeek Park, Seattle, WA',
  },
  {
    file: 'Lesser_scaup_hen_on_Union_Bay_Natural_Area.jpg',
    lat: 47.6543, lon: -122.2952, month: 10, location: 'Union Bay Natural Area, Seattle, WA',
  },
  {
    file: 'Mallard_drake_on_Union_Bay_Natural_Area.jpg',
    lat: 47.6543, lon: -122.2952, month: 10, location: 'Union Bay Natural Area, Seattle, WA',
  },
  {
    file: 'Stellers_Jay_eating_cherries_Seattle_backyard.jpg',
    lat: 47.6399, lon: -122.4039, month: 5, location: 'Seattle, WA',
  },
  {
    file: 'Tufted_puffin_near_Smith_Island_Washington.jpg',
    lat: 48.3204, lon: -122.8352, month: 7, location: 'Smith Island, WA',
  },
  {
    file: 'Common_goldeneye_at_Discovery_Park_Seattle.jpeg',
    lat: 47.6600, lon: -122.4287, month: 0, location: 'Discovery Park, Seattle, WA',
  },
  // ── Chicago / Midwest ────────────────────────────────────
  {
    file: 'Black-throated_blue_warbler_in_Chicago_park.jpg',
    lat: 41.9632, lon: -87.6342, month: 8, location: 'Montrose Point, Chicago, IL',
  },
  {
    file: 'Female_northern_cardinal_in_Chicago_park.jpg',
    lat: 41.9632, lon: -87.6342, month: 8, location: 'Chicago, IL',
  },
  {
    file: 'House_sparrow_bathing_in_mosaic_fountain_Park_Ridge.jpg',
    lat: 42.0089, lon: -87.8310, month: 8, location: 'Park Ridge, IL',
  },
  {
    file: 'Palm_warbler_on_Lake_Michigan_shore_Chicago.jpg',
    lat: 41.9632, lon: -87.6342, month: 8, location: 'Lake Michigan shore, Chicago, IL',
  },
  {
    file: 'Sanderling_foraging_Lake_Michigan_Chicago.jpg',
    lat: 41.9632, lon: -87.6342, month: 8, location: 'Lake Michigan, Chicago, IL',
  },
  // ── Hawaii ───────────────────────────────────────────────
  {
    file: 'Chukar_partridge_near_Haleakala_summit_Maui.jpg',
    lat: 20.7148, lon: -156.2502, month: 11, location: 'Haleakala, Maui, HI',
  },
  // ── Europe ───────────────────────────────────────────────
  {
    file: 'Pigeons_near_Museumplein_Amsterdam.jpg',
    lat: 52.3581, lon: 4.8826, month: 11, location: 'Museumplein, Amsterdam, Netherlands',
  },
  {
    file: 'Cormorant_on_mooring_post_Lake_Como.jpg',
    lat: 45.8097, lon: 9.0846, month: 8, location: 'Lake Como, Italy',
  },
  // ── Asia ─────────────────────────────────────────────────
  {
    file: 'Geese_in_misty_rice_paddies_Dehua_Fujian.jpg',
    lat: 25.7, lon: 118.24, month: 0, location: 'Dehua, Fujian, China',
  },
  {
    file: 'Common_kingfisher_at_Taipei_Zoo.jpeg',
    lat: 24.998, lon: 121.581, month: 11, location: 'Taipei Zoo, Taiwan',
  },
  // ── Edge cases ───────────────────────────────────────────
  {
    file: 'AI_generated_ambiguous_bird.png',
    // AI-generated image, no real GPS. Use generic coords.
    lat: 40.0, lon: -100.0, month: 5, location: 'Unknown (AI-generated test image)',
  },
  {
    file: 'Unknown_bird_no_GPS.jpeg',
    // Intentionally no GPS, tests the "no location" path
    lat: undefined, lon: undefined, month: undefined, location: undefined,
  },
]

async function captureOne(entry, model) {
  const imgPath = join(import.meta.dirname, '..', 'src', 'assets', 'images', entry.file)
  if (!existsSync(imgPath)) {
    console.warn(`⚠️  Skipping ${entry.file}: file not found`)
    return
  }

  const key = entry.file.replace(/\.[^.]+$/, '')
  const outDir = fixtureDir(model)
  const outPath = join(outDir, `${key}.json`)
  if (!FIXTURE_TIMING_ONLY && !FIXTURE_OVERWRITE && existsSync(outPath)) {
    console.log(`⏭️  ${key}: fixture exists, skipping`)
    return
  }

  console.log(`📸 ${entry.file}...`)
  const imgBuf = readFileSync(imgPath)
  const sourceMeta = await sharp(imgBuf).metadata()
  const resizedBuf = await sharp(imgBuf)
    .rotate()
    .resize({
      width: RESIZE_MAX_DIM,
      height: RESIZE_MAX_DIM,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer()
  const resizedMeta = await sharp(resizedBuf).metadata()

  const b64 = resizedBuf.toString('base64')
  const dataUrl = `data:image/jpeg;base64,${b64}`

  const prompt = buildBirdIdPrompt(
    entry.lat != null && entry.lon != null ? { lat: entry.lat, lon: entry.lon } : undefined,
    entry.month,
    entry.location,
  )

  const body = {
    model,
    ...withReasoningOptions(model),
    ...withSamplingOptions(model),
    ...withTokenLimit(model, MAX_COMPLETION_TOKENS),
    messages: [
      { role: 'system', content: 'You are an expert ornithologist assistant. Return only what is asked.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'auto' } },
        ],
      },
    ],
    response_format: { type: 'json_object' },
  }

  const startedAt = Date.now()
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(CF_AIG_TOKEN ? { 'cf-aig-authorization': `Bearer ${CF_AIG_TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const durationMs = Date.now() - startedAt

  if (!res.ok) {
    const errText = await res.text()
    console.error(`❌ ${entry.file}: HTTP ${res.status}, ${errText.substring(0, 200)}`)
    return null
  }

  const json = await res.json()
  const modelRawResponse = json.choices[0].message.content

  let parsed = null
  try { parsed = JSON.parse(modelRawResponse) } catch {}
  const canonicalParsed = canonicalizeParsed(parsed)
  const rawResponse = canonicalParsed ? JSON.stringify(canonicalParsed) : modelRawResponse

  if (!FIXTURE_TIMING_ONLY) {
    const fixture = {
      imageFile: entry.file,
      context: {
        lat: entry.lat,
        lon: entry.lon,
        month: entry.month,
        locationName: entry.location,
      },
      rawResponse,
      parsed: canonicalParsed,
      model,
      requestConfig: {
        tokenParam: shouldUseMaxCompletionTokens(model) ? 'max_completion_tokens' : 'max_tokens',
        maxCompletionTokens: MAX_COMPLETION_TOKENS,
        reasoningEffort: withReasoningOptions(model).reasoning_effort || null,
        resizedBeforeSend: true,
        resizeMaxDim: RESIZE_MAX_DIM,
        jpegQuality: JPEG_QUALITY,
        sourceDimensions: {
          width: sourceMeta.width || null,
          height: sourceMeta.height || null,
        },
        uploadedDimensions: {
          width: resizedMeta.width || null,
          height: resizedMeta.height || null,
        },
      },
      durationMs,
      capturedAt: new Date().toISOString(),
    }

    writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n')
  }
  console.log(`✅ ${key}: ${canonicalParsed?.candidates?.length ?? 0} candidates`)
  if (canonicalParsed?.candidates) {
    for (const c of canonicalParsed.candidates) {
      console.log(`   ${c.species} (${c.confidence})`)
    }
  }

  return durationMs
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return null
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1))
  return sortedValues[index]
}

async function main() {
  console.log(`\n🐦 ${FIXTURE_TIMING_ONLY ? 'Capturing LLM timing' : 'Capturing LLM fixtures'} for ${IMAGES.length} images, ${MODELS.length} model(s)...\n`)
  if (FIXTURE_TIMING_ONLY) {
    console.log('ℹ️  FIXTURE_TIMING_ONLY=true → no fixture files will be written')
  } else if (FIXTURE_OVERWRITE) {
    console.log('ℹ️  FIXTURE_OVERWRITE=true → existing fixture files will be replaced')
  }

  for (const model of MODELS) {
    console.log(`\n── Model: ${model} ──\n`)
    const durations = []

    for (const entry of IMAGES) {
      const durationMs = await captureOne(entry, model)
      if (typeof durationMs === 'number') {
        durations.push(durationMs)
      }
      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 1000))
    }

    if (durations.length > 0) {
      const sorted = [...durations].sort((a, b) => a - b)
      const median = percentile(sorted, 50)
      const p95 = percentile(sorted, 95)
      const min = sorted[0]
      const max = sorted[sorted.length - 1]

      console.log(`\n⏱️ Timing summary for ${model} (ms):`)
      console.log(`   min: ${min}`)
      console.log(`   median: ${median}`)
      console.log(`   p95: ${p95}`)
      console.log(`   max: ${max}`)
    }
  }

  console.log('\n✅ Done! Fixtures written to src/__tests__/fixtures/llm-responses/')
}

main().catch(e => { console.error(e); process.exit(1) })
