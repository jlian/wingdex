#!/usr/bin/env node
/**
 * Test range-prior lookups locally by reading cell blobs from disk.
 *
 * Simulates what the CF Worker would do with R2, using the filesystem instead.
 * Tests various species/location/month combos to verify the system works.
 *
 * Usage:
 *   node --experimental-strip-types scripts/test-range-filter-local.mjs
 */
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { gunzipSync } from 'zlib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CELLS_DIR = resolve(__dirname, '../.tmp/range-priors/cells')

// ------- Inline the projection + parsing logic (mirrors range-filter.ts) -------

const ORIGIN_X = -17226000
const ORIGIN_Y = 8343000
const CELL_SIZE = 27000
const GRID_COLS = 1276
const GRID_ROWS = 618
const RECORD_SIZE = 11

function lonLatToEqualEarth(lon, lat) {
  const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796
  const a = 6378137.0, f = 1 / 298.257223563
  const b = a * (1 - f), e2 = 1 - (b * b) / (a * a), e = Math.sqrt(e2)
  const R = a * Math.sqrt(0.5 * (1 + ((1 - e2) / (2 * e)) * Math.log((1 + e) / (1 - e))))
  const qp = 1 + ((1 - e2) / (2 * e)) * Math.log((1 + e) / (1 - e))

  const lam = (lon * Math.PI) / 180
  const phi = (lat * Math.PI) / 180
  const sinPhi = Math.sin(phi)
  const eSin = e * sinPhi
  const q = (1 - e2) * (sinPhi / (1 - e2 * sinPhi * sinPhi) - (1 / (2 * e)) * Math.log((1 - eSin) / (1 + eSin)))
  const beta = Math.asin(q / qp)
  const sinBeta = Math.sin(beta)
  const theta = Math.asin((Math.sqrt(3) / 2) * sinBeta)
  const t = theta, t2 = t * t, t6 = t2 * t2 * t2
  const denom = 3 * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))
  const x = R * ((2 * Math.sqrt(3) * lam * Math.cos(t)) / denom)
  const y = R * t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2))
  return { x, y }
}

function lookup(lon, lat, month, speciesCodes) {
  const { x, y } = lonLatToEqualEarth(lon, lat)
  const col = Math.floor((x - ORIGIN_X) / CELL_SIZE)
  const row = Math.floor((ORIGIN_Y - y) / CELL_SIZE)

  if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) {
    return speciesCodes.map(code => ({ code, status: 'no-data', note: 'outside grid' }))
  }

  const blobPath = resolve(CELLS_DIR, `${row}-${col}.bin.gz`)
  if (!existsSync(blobPath)) {
    return speciesCodes.map(code => ({ code, status: 'no-data', note: 'no blob' }))
  }

  const compressed = readFileSync(blobPath)
  const data = gunzipSync(compressed)

  // Parse 11-byte records: 8-byte code + uint8 presence + uint8 origin_mask + uint8 seasonal_mask
  const speciesMap = new Map()
  for (let offset = 0; offset + RECORD_SIZE <= data.length; offset += RECORD_SIZE) {
    const code = data.subarray(offset, offset + 8).toString('ascii').trimEnd()
    const presence = data[offset + 8]
    const originMask = data[offset + 9]
    const seasonalMask = data[offset + 10]
    speciesMap.set(code, { presence, originMask, seasonalMask })
  }

  return speciesCodes.map(code => {
    const rec = speciesMap.get(code)
    if (!rec) {
      return { code, status: 'out-of-range' }
    }
    return { code, status: 'present', presence: rec.presence, origin: rec.originMask, seasonal: rec.seasonalMask }
  })
}

// Base status multipliers only (does not replicate the layered
// presence/origin/seasonal adjustments from range-adjust.js).
const TRUST = { present: 1.0, 'near-range': 0.85, 'out-of-range': 0.5, 'no-data': 1.0 }
function adjustConfidence(confidence, status) {
  return confidence * TRUST[status]
}

// ------- Test scenarios -------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const scenarios = [
  {
    name: 'Bald Eagle in Seattle (Jan) - should be in range',
    lat: 47.61, lon: -122.33, month: 0,
    candidates: [
      { species: 'Bald Eagle', code: 'baleag', llmConf: 0.92 },
      { species: 'Golden Eagle', code: 'goleag', llmConf: 0.45 },
    ],
  },
  {
    name: 'Bald Eagle in Seattle (Jul) - lower but still present',
    lat: 47.61, lon: -122.33, month: 6,
    candidates: [
      { species: 'Bald Eagle', code: 'baleag', llmConf: 0.85 },
    ],
  },
  {
    name: 'Bald Eagle in Honolulu (Jan) - should NOT be in range',
    lat: 21.31, lon: -157.86, month: 0,
    candidates: [
      { species: 'Bald Eagle', code: 'baleag', llmConf: 0.70 },
    ],
  },
  {
    name: 'Bald Eagle in London (Apr) - should NOT be in range',
    lat: 51.51, lon: -0.12, month: 3,
    candidates: [
      { species: 'Bald Eagle', code: 'baleag', llmConf: 0.65 },
    ],
  },
  {
    name: 'Bald Eagle in Miami (Jan) - marginal range',
    lat: 25.76, lon: -80.19, month: 0,
    candidates: [
      { species: 'Bald Eagle', code: 'baleag', llmConf: 0.75 },
    ],
  },
  {
    name: 'Bald Eagle in Anchorage (Apr) - peak season',
    lat: 61.22, lon: -149.90, month: 3,
    candidates: [
      { species: 'Bald Eagle', code: 'baleag', llmConf: 0.88 },
    ],
  },
  {
    name: 'Unknown species at any location (tests missing code)',
    lat: 47.61, lon: -122.33, month: 0,
    candidates: [
      { species: 'Imaginary Bird', code: 'imgbrd', llmConf: 0.60 },
    ],
  },
  {
    name: 'White-rumped Shama in Vietnam (was missing with S&T)',
    lat: 11.43, lon: 107.44, month: 0,
    candidates: [
      { species: 'White-rumped Shama', code: 'whrsha', llmConf: 0.85 },
    ],
  },
  {
    name: 'African Stonechat near Kilimanjaro (Feb)',
    lat: -3.01, lon: 37.23, month: 1,
    candidates: [
      { species: 'African Stonechat', code: 'afrsto1', llmConf: 0.51 },
      { species: 'Familiar Chat', code: 'famcha1', llmConf: 0.42 },
    ],
  },
]

console.log('=== Range Prior Local Test ===\n')

if (!existsSync(CELLS_DIR)) {
  console.error(`No cell blobs found at ${CELLS_DIR}`)
  console.error('Run: /tmp/st-test/bin/python3 scripts/build-range-priors.py')
  process.exit(1)
}

for (const scenario of scenarios) {
  console.log(`--- ${scenario.name} ---`)
  console.log(`  Location: (${scenario.lat}, ${scenario.lon}), Month: ${MONTHS[scenario.month]}`)

  const codes = scenario.candidates.map(c => c.code)
  const results = lookup(scenario.lon, scenario.lat, scenario.month, codes)

  for (let i = 0; i < scenario.candidates.length; i++) {
    const c = scenario.candidates[i]
    const r = results[i]
    const adjusted = adjustConfidence(c.llmConf, r.status)
    const delta = adjusted - c.llmConf
    const deltaStr = delta === 0 ? '(no change)' : `(${delta > 0 ? '+' : ''}${delta.toFixed(2)})`

    console.log(`  ${c.species}: LLM=${c.llmConf.toFixed(2)} -> adjusted=${adjusted.toFixed(2)} ${deltaStr}`)
    console.log(`    status=${r.status}${r.note ? ', ' + r.note : ''}`)
  }
  console.log()
}
