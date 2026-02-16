#!/usr/bin/env node
/**
 * Capture real LLM responses for test fixtures.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx node scripts/capture-llm-fixtures.mjs
 *
 * Reads images from src/assets/images/, sends each to the GitHub Models
 * vision API with the same prompt used in production, and writes the raw
 * response to src/__tests__/fixtures/llm-responses/<image-key>.json.
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

const API_URL = 'https://models.github.ai/inference/chat/completions'
const MODEL = 'openai/gpt-4.1-mini'
const TOKEN = process.env.GITHUB_TOKEN
if (!TOKEN) { console.error('GITHUB_TOKEN required'); process.exit(1) }

const FIXTURE_DIR = join(import.meta.dirname, '..', 'src', '__tests__', 'fixtures', 'llm-responses')
mkdirSync(FIXTURE_DIR, { recursive: true })

// Canonical image set with context metadata
const IMAGES = [
  {
    file: 'American_goldfinch_in_maple_at_Union_Bay_Natural_Area.jpg',
    lat: 47.6564, lon: -122.2924, month: 8, location: 'Union Bay Natural Area, Seattle, WA',
  },
  {
    file: "Anna's_hummingbird_in_Seattle_garden.jpg",
    lat: 47.6, lon: -122.33, month: 3, location: 'Seattle, WA',
  },
  {
    file: 'Chukar_partridge_near_Haleakala_summit_Maui.jpg',
    lat: 20.7204, lon: -156.1552, month: 11, location: 'Haleakala, Maui, HI',
  },
  {
    file: 'Cormorants_on_navigation_marker_Skagit_Bay.jpg',
    lat: 48.3918, lon: -122.4885, month: 6, location: 'Skagit Bay, WA',
  },
  {
    file: 'Dark-eyed_junco_in_foliage_Seattle_Arboretum.jpg',
    lat: 47.6399, lon: -122.2958, month: 10, location: 'Washington Park Arboretum, Seattle, WA',
  },
  {
    file: 'Stellers_Jay_eating_cherries_Seattle_backyard.jpg',
    lat: 47.68, lon: -122.34, month: 7, location: 'Seattle, WA',
  },
  {
    file: 'Pigeons_near_Museumplein_Amsterdam.jpg',
    lat: 52.3579, lon: 4.8815, month: 4, location: 'Museumplein, Amsterdam, Netherlands',
  },
  {
    file: 'Geese_in_misty_rice_paddies_Dehua_Fujian.jpg',
    lat: 25.7, lon: 118.24, month: 1, location: 'Dehua, Fujian, China',
  },
]

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function buildPrompt(ctx) {
  const ctxParts = []
  if (ctx.lat != null) ctxParts.push(`Primary geolocation (authoritative): GPS ${ctx.lat.toFixed(4)}, ${ctx.lon.toFixed(4)}.`)
  if (ctx.location) ctxParts.push(`Place label (secondary, may be noisy): ${ctx.location}.`)
  if (ctx.month != null) ctxParts.push(`Month: ${MONTHS[ctx.month]}.`)
  const ctxStr = ctxParts.length ? `\nContext:\n- ${ctxParts.join('\n- ')}` : ''

  return `Identify birds in this image and return ONE JSON object only.${ctxStr}

  Process (in order):
  1) Detect all birds.
  2) Select ONE focal bird: prefer the most notable/uncommon species; if all are common (gulls, pigeons, crows, sparrows), pick the largest clear one; if tied, nearest image center.
  3) Note the focal bird's center position in the image as a percentage.
  4) Identify only that focal bird.

  Rules:
  - Never mix traits across birds.
  - GPS and month are authoritative range constraints.
  - Location name is secondary habitat context only. If it conflicts with GPS/month, trust GPS/month.
  - Only suggest species expected at that location/time; account for regional splits and seasonal plumage.
  - Lower confidence for small/blurry/occluded/backlit birds.

  Candidates:
  - Return 1-3 candidates total (1 primary + up to 2 alternatives), sorted by confidence descending.
  - species format: "Common Name (Scientific name)".

  Confidence:
  - 0.90-1.00 diagnostic field marks clearly visible
  - 0.75-0.89 strong match
  - 0.50-0.74 likely
  - 0.30-0.49 possible

  Output JSON only:
  - Bird present: {"candidates":[{"species":"Common Name (Scientific name)","confidence":0.87}],"birdCenter":[35,60],"birdSize":"medium","multipleBirds":false}
  - No bird: {"candidates":[],"birdCenter":null,"birdSize":null,"multipleBirds":false}

  multipleBirds: true if more than one bird species is visible in the image.

  birdCenter: [x, y] percentage position of the focal bird's center.
  - Values 0-100 (percentage of image width and height)
  - integers only

  birdSize: how much of the image the bird fills.
  - "small" = bird is <20% of image area
  - "medium" = bird is 20-50%
  - "large" = bird is >50%`
}

async function captureOne(entry) {
  const imgPath = join(import.meta.dirname, '..', 'src', 'assets', 'images', entry.file)
  if (!existsSync(imgPath)) {
    console.warn(`⚠️  Skipping ${entry.file}: file not found`)
    return
  }

  const key = entry.file.replace(/\.[^.]+$/, '')
  const outPath = join(FIXTURE_DIR, `${key}.json`)
  if (existsSync(outPath)) {
    console.log(`⏭️  ${key}: fixture exists, skipping`)
    return
  }

  console.log(`📸 ${entry.file}...`)
  const imgBuf = readFileSync(imgPath)
  const b64 = imgBuf.toString('base64')
  const mime = entry.file.endsWith('.png') ? 'image/png' : 'image/jpeg'
  const dataUrl = `data:${mime};base64,${b64}`

  const prompt = buildPrompt(entry)

  const body = {
    model: MODEL,
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
    temperature: 0.2,
    top_p: 1.0,
    max_tokens: 500,
    response_format: { type: 'json_object' },
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text()
    console.error(`❌ ${entry.file}: HTTP ${res.status} — ${errText.substring(0, 200)}`)
    return
  }

  const json = await res.json()
  const rawResponse = json.choices[0].message.content

  let parsed = null
  try { parsed = JSON.parse(rawResponse) } catch {}

  const fixture = {
    imageFile: entry.file,
    context: {
      lat: entry.lat,
      lon: entry.lon,
      month: entry.month,
      locationName: entry.location,
    },
    rawResponse,
    parsed,
    model: MODEL,
    capturedAt: new Date().toISOString(),
  }

  writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n')
  console.log(`✅ ${key}: ${parsed?.candidates?.length ?? 0} candidates`)
  if (parsed?.candidates) {
    for (const c of parsed.candidates) {
      console.log(`   ${c.species} (${c.confidence})`)
    }
  }
}

async function main() {
  console.log(`\n🐦 Capturing LLM fixtures for ${IMAGES.length} images...\n`)
  for (const entry of IMAGES) {
    await captureOne(entry)
    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 1000))
  }
  console.log('\n✅ Done! Fixtures written to src/__tests__/fixtures/llm-responses/')
}

main().catch(e => { console.error(e); process.exit(1) })
