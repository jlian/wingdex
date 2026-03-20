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
import sharp from 'sharp'
import { buildBirdIdPrompt, BIRD_ID_INSTRUCTIONS, BIRD_ID_SCHEMA } from '../functions/lib/bird-id-prompt.js'

// ── Constants ───────────────────────────────────────────────

const ROOT = import.meta.dirname ? join(import.meta.dirname, '..') : process.cwd()
const IMAGE_DIR = join(ROOT, 'src', 'assets', 'images')
const FIXTURE_BASE_DIR = join(ROOT, 'src', '__tests__', 'fixtures', 'llm-responses')
const RESULTS_DIR = join(ROOT, 'test-results')

const MAX_OUTPUT_TOKENS = 1400
const RESIZE_MAX_DIM = 640
const JPEG_QUALITY = 70

const BENCHMARK_VARIANTS = [
  { model: 'gpt-4.1-mini', reasoning: null },
  { model: 'gpt-5-mini', reasoning: 'low' },
  { model: 'gpt-5.4-mini', reasoning: 'none' },
  { model: 'gpt-5.4-mini', reasoning: 'low' },
  { model: 'gpt-5.4-nano', reasoning: 'none' },
  { model: 'gpt-5.4-nano', reasoning: 'low' },
]

const TAXONOMY = JSON.parse(readFileSync(join(ROOT, 'src', 'lib', 'taxonomy.json'), 'utf8'))
const SCIENTIFIC_TO_COMMON = new Map(
  TAXONOMY.map(entry => [String(entry[1]).toLowerCase(), String(entry[0])])
)

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
  { file: 'Lesser_scaup_hen_on_Union_Bay_Natural_Area.jpg', lat: 47.6543, lon: -122.2952, month: 10, location: 'Union Bay Natural Area, Seattle, WA', truth: 'Lesser Scaup' },
  { file: 'Mallard_drake_on_Union_Bay_Natural_Area.jpg', lat: 47.6543, lon: -122.2952, month: 10, location: 'Union Bay Natural Area, Seattle, WA', truth: 'Mallard' },
  { file: 'Stellers_Jay_eating_cherries_Seattle_backyard.jpg', lat: 47.6399, lon: -122.4039, month: 5, location: 'Seattle, WA', truth: "Steller's Jay" },
  { file: 'Tufted_puffin_near_Smith_Island_Washington.jpg', lat: 48.3204, lon: -122.8352, month: 7, location: 'Smith Island, WA', truth: 'Tufted Puffin' },
  { file: 'Common_goldeneye_at_Discovery_Park_Seattle.jpeg', lat: 47.6600, lon: -122.4287, month: 0, location: 'Discovery Park, Seattle, WA', truth: 'Common Goldeneye' },
  // Chicago / Midwest
  { file: 'Black-throated_blue_warbler_in_Chicago_park.jpg', lat: 41.9632, lon: -87.6342, month: 8, location: 'Montrose Point, Chicago, IL', truth: 'Black-throated Blue Warbler' },
  { file: 'Female_northern_cardinal_in_Chicago_park.jpg', lat: 41.9632, lon: -87.6342, month: 8, location: 'Chicago, IL', truth: 'Northern Cardinal' },
  { file: 'House_sparrow_bathing_in_mosaic_fountain_Park_Ridge.jpg', lat: 42.0089, lon: -87.8310, month: 8, location: 'Park Ridge, IL', truth: 'House Sparrow' },
  { file: 'Palm_warbler_on_Lake_Michigan_shore_Chicago.jpg', lat: 41.9632, lon: -87.6342, month: 8, location: 'Lake Michigan shore, Chicago, IL', truth: 'Palm Warbler' },
  { file: 'Sanderling_foraging_Lake_Michigan_Chicago.jpg', lat: 41.9632, lon: -87.6342, month: 8, location: 'Lake Michigan, Chicago, IL', truth: 'Sanderling' },
  // Hawaii
  { file: 'Chukar_partridge_near_Haleakala_summit_Maui.jpg', lat: 20.7148, lon: -156.2502, month: 11, location: 'Haleakala, Maui, HI', truth: 'Chukar' },
  // Europe
  { file: 'Pigeons_near_Museumplein_Amsterdam.jpg', lat: 52.3581, lon: 4.8826, month: 11, location: 'Museumplein, Amsterdam, Netherlands', truth: 'Pigeon' },
  { file: 'Cormorant_on_mooring_post_Lake_Como.jpg', lat: 45.8097, lon: 9.0846, month: 8, location: 'Lake Como, Italy', truth: 'Cormorant' },
  // Asia
  { file: 'Geese_in_misty_rice_paddies_Dehua_Fujian.jpg', lat: 25.7, lon: 118.24, month: 0, location: 'Dehua, Fujian, China', truth: 'Goose' },
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

function variantName(model, reasoning) {
  if (!reasoning) return model
  return `${model}-reasoning-${reasoning}`
}

function variantDir(variant) {
  const dir = join(FIXTURE_BASE_DIR, variant)
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

async function captureOne(entry, model, reasoning, env, outDir, overwrite) {
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

  const body = {
    model,
    store: false,
    ...(isReasoningModel(model) ? { reasoning: { effort: reasoning || 'low' } } : {}),
    ...(isReasoningModel(model) ? {} : { temperature: 0.2, top_p: 1.0 }),
    max_output_tokens: MAX_OUTPUT_TOKENS,
    instructions: BIRD_ID_INSTRUCTIONS,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          { type: 'input_image', image_url: dataUrl, detail: 'auto' },
        ],
      },
    ],
    text: { format: BIRD_ID_SCHEMA },
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

async function captureVariant(model, reasoning, env, overwrite) {
  const variant = variantName(model, reasoning)
  const outDir = variantDir(variant)

  console.log(`\n── ${variant} ──\n`)
  const durations = []

  for (const entry of IMAGES) {
    const ms = await captureOne(entry, model, reasoning, env, outDir, overwrite)
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
  const dir = join(FIXTURE_BASE_DIR, variant)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')))
}

function analyzeVariants() {
  // Find all variant subdirectories
  const allEntries = readdirSync(FIXTURE_BASE_DIR, { withFileTypes: true })
  const variantDirs = allEntries
    .filter(e => e.isDirectory() && e.name !== 'strong')
    .map(e => e.name)
    .sort()

  if (variantDirs.length === 0) {
    console.error('No variant directories found. Run capture first.')
    process.exitCode = 1
    return
  }

  // Build ground-truth map from IMAGES array (substring match, case-insensitive)
  const truthByFile = new Map(
    IMAGES.filter(img => img.truth).map(img => [img.file, img.truth])
  )

  function matchesTruth(species, truth) {
    return species.toLowerCase().includes(truth.toLowerCase())
  }

  const rows = []
  const report = { analyzedAt: new Date().toISOString(), variants: {} }
  const misses = {} // variant -> [{file, truth, got}]

  for (const variant of variantDirs) {
    const fixtures = loadVariantFixtures(variant)
    if (fixtures.length === 0) continue

    const durations = fixtures.map(f => f.durationMs).filter(v => typeof v === 'number')
    const stats = timingStats(durations)
    const parseCount = fixtures.filter(f => f.parsed && Array.isArray(f.parsed.candidates)).length

    // Top-1 accuracy vs ground truth (substring match)
    let correctCount = 0
    let comparableCount = 0
    const variantMisses = []
    for (const f of fixtures) {
      const truth = truthByFile.get(f.imageFile)
      if (!truth) continue
      const top1 = f.parsed?.candidates?.[0]
      const top1Name = top1?.commonName || top1?.species || ''
      if (!top1Name) continue
      comparableCount++
      if (matchesTruth(top1Name, truth)) {
        correctCount++
      } else {
        variantMisses.push({ file: f.imageFile, truth, got: top1Name })
      }
    }
    misses[variant] = variantMisses

    const accuracyPct = comparableCount > 0
      ? `${Math.round((correctCount / comparableCount) * 100)}%`
      : 'n/a'
    const accuracyFrac = `${correctCount}/${comparableCount}`

    // Top-1 confidence for correct IDs only
    const correctConfidences = []
    for (const f of fixtures) {
      const truth = truthByFile.get(f.imageFile)
      if (!truth) continue
      const top1 = f.parsed?.candidates?.[0]
      const top1Name = top1?.commonName || top1?.species || ''
      if (top1 && matchesTruth(top1Name, truth)) {
        correctConfidences.push(top1.confidence)
      }
    }
    const avgCorrectConf = correctConfidences.length > 0
      ? (correctConfidences.reduce((s, v) => s + v, 0) / correctConfidences.length).toFixed(2)
      : 'n/a'

    // Token usage stats
    const inputTokens = fixtures.map(f => f.usage?.input_tokens).filter(v => typeof v === 'number')
    const outputTokens = fixtures.map(f => f.usage?.output_tokens).filter(v => typeof v === 'number')
    const reasoningTokens = fixtures.map(f => f.usage?.output_tokens_details?.reasoning_tokens).filter(v => typeof v === 'number')
    const medianInput = percentile(inputTokens, 50)
    const medianOutput = percentile(outputTokens, 50)
    const medianReasoning = percentile(reasoningTokens, 50)

    rows.push({
      variant,
      images: fixtures.length,
      parsed: `${parseCount}/${fixtures.length}`,
      medianMs: stats.median,
      p95Ms: stats.p95,
      accuracy: accuracyPct,
      accuracyFrac,
      avgCorrectConf,
      medianInput,
      medianOutput,
      medianReasoning,
    })

    report.variants[variant] = {
      fixtureCount: fixtures.length,
      parseRate: parseCount / fixtures.length,
      timing: stats,
      accuracy: { correct: correctCount, comparable: comparableCount, rate: comparableCount > 0 ? correctCount / comparableCount : null },
      avgCorrectConfidence: correctConfidences.length > 0 ? correctConfidences.reduce((s, v) => s + v, 0) / correctConfidences.length : null,
      tokens: {
        medianInput,
        medianOutput,
        medianReasoning,
        totalInput: inputTokens.reduce((s, v) => s + v, 0),
        totalOutput: outputTokens.reduce((s, v) => s + v, 0),
      },
      misidentifications: variantMisses,
    }
  }

  // Print summary table
  console.log('\n=== Benchmark Analysis (vs Ground Truth) ===\n')
  const header = `| ${'Variant'.padEnd(35)} | Accuracy    | Median ms | p95 ms | Avg Conf | In tok | Out tok | Reas tok |`
  const sep = `|${'-'.repeat(37)}|-------------|-----------|--------|----------|--------|---------|----------|`
  console.log(header)
  console.log(sep)
  for (const r of rows) {
    const accStr = `${r.accuracy} (${r.accuracyFrac})`
    console.log(
      `| ${r.variant.padEnd(35)} | ${accStr.padStart(11)} | ${String(r.medianMs ?? '-').padStart(9)} | ${String(r.p95Ms ?? '-').padStart(6)} | ${String(r.avgCorrectConf).padStart(8)} | ${String(r.medianInput ?? '-').padStart(6)} | ${String(r.medianOutput ?? '-').padStart(7)} | ${String(r.medianReasoning ?? '-').padStart(8)} |`
    )
  }

  // Print misidentifications
  const anyMisses = Object.values(misses).some(m => m.length > 0)
  if (anyMisses) {
    console.log('\n── Misidentifications ──\n')
    for (const variant of variantDirs) {
      const m = misses[variant]
      if (!m || m.length === 0) continue
      console.log(`${variant}:`)
      for (const miss of m) {
        const shortFile = miss.file.replace(/\.[^.]+$/, '').substring(0, 40)
        console.log(`  ${shortFile.padEnd(42)} truth: ${miss.truth.padEnd(28)} got: ${miss.got}`)
      }
      console.log()
    }
  }

  // Write report JSON
  mkdirSync(RESULTS_DIR, { recursive: true })
  const reportPath = join(RESULTS_DIR, 'benchmark-analysis.json')
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
  console.log(`Report written to ${reportPath}`)
}

// ── Promote ─────────────────────────────────────────────────

function promoteVariant(variant) {
  const srcDir = join(FIXTURE_BASE_DIR, variant)
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

  mkdirSync(FIXTURE_BASE_DIR, { recursive: true })
  let copied = 0
  for (const file of files) {
    copyFileSync(join(srcDir, file), join(FIXTURE_BASE_DIR, file))
    copied++
  }

  console.log(`Promoted ${copied} fixtures from ${variant} to golden baseline`)
  console.log(`Path: ${FIXTURE_BASE_DIR}`)
}

// ── CLI ─────────────────────────────────────────────────────

function printHelp() {
  console.log(`Usage: node scripts/capture-llm-fixtures.mjs [mode] [options]

Modes:
  (default)           Capture fixtures for one model variant
  benchmark           Capture all 6 benchmark variants
  analyze             Compare all captured variants
  promote <variant>   Copy variant fixtures to golden baseline

Options (capture mode):
  --model <name>             Model to use (required for single capture)
  --reasoning <none|low>     Reasoning effort (omit for non-reasoning models)
  --overwrite                Overwrite existing fixture files

Environment:
  OPENAI_API_KEY, CF_ACCOUNT_ID, AI_GATEWAY_ID (or .dev.vars)

Benchmark variants:
${BENCHMARK_VARIANTS.map(v => `  ${variantName(v.model, v.reasoning)}`).join('\n')}

Examples:
  node scripts/capture-llm-fixtures.mjs --model gpt-5.4-mini --reasoning none
  node scripts/capture-llm-fixtures.mjs benchmark
  node scripts/capture-llm-fixtures.mjs analyze
  node scripts/capture-llm-fixtures.mjs promote gpt-5.4-mini-reasoning-none
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
    console.log(`\nBenchmark: capturing ${BENCHMARK_VARIANTS.length} variants, ${IMAGES.length} images each\n`)
    for (const v of BENCHMARK_VARIANTS) {
      await captureVariant(v.model, v.reasoning, env, true)
    }
    console.log('\nAll variants captured. Run "analyze" to compare results.\n')
    return
  }

  // Single capture
  if (!args.model) { console.error('--model required (or use "benchmark" mode)'); printHelp(); process.exitCode = 1; return }
  await captureVariant(args.model, args.reasoning, env, args.overwrite)
}

main().catch(e => { console.error(e); process.exit(1) })
