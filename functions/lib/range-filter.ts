/**
 * Range-prior filter: adjusts bird-ID confidence using BirdLife International
 * species distribution data stored as pre-computed per-cell blobs in R2.
 *
 * Each R2 object is a gzipped binary blob keyed by grid cell:
 *   range-priors/{row}-{col}.bin.gz
 *
 * Blob format: repeated 20-byte records, no header:
 *   [8-byte ASCII species code] [12 x uint8 monthly occurrence (0-255)]
 *
 * Grid: EPSG:8857 (Equal Earth), 27km cells, 1276x618.
 */

// EPSG:8857 Equal Earth grid constants
const ORIGIN_X = -17226000
const ORIGIN_Y = 8343000
const CELL_SIZE = 27000
const GRID_COLS = 1276
const GRID_ROWS = 618

/** Bytes per species record in the binary blob. */
const RECORD_SIZE = 20

/**
 * Convert WGS84 (lon, lat) to EPSG:8857 (Equal Earth) coordinates.
 *
 * Uses the ellipsoidal Equal Earth projection: geodetic latitude is first
 * converted to authalic latitude on the WGS84 ellipsoid, then the Equal
 * Earth forward formulas are applied (Savric, Patterson, Jenny 2018).
 */
function lonLatToEqualEarth(lon: number, lat: number): { x: number; y: number } {
  const A1 = 1.340264
  const A2 = -0.081106
  const A3 = 0.000893
  const A4 = 0.003796

  // WGS84 ellipsoid
  const a = 6378137.0
  const f = 1 / 298.257223563
  const b = a * (1 - f)
  const e2 = 1 - (b * b) / (a * a)
  const e = Math.sqrt(e2)

  // Authalic sphere radius
  const R = a * Math.sqrt(0.5 * (1 + ((1 - e2) / (2 * e)) * Math.log((1 + e) / (1 - e))))

  // qp for authalic latitude conversion
  const qp = 1 + ((1 - e2) / (2 * e)) * Math.log((1 + e) / (1 - e))

  const lam = (lon * Math.PI) / 180
  const phi = (lat * Math.PI) / 180

  // Geodetic to authalic latitude
  const sinPhi = Math.sin(phi)
  const eSin = e * sinPhi
  const q = (1 - e2) * (sinPhi / (1 - e2 * sinPhi * sinPhi) - (1 / (2 * e)) * Math.log((1 - eSin) / (1 + eSin)))
  const beta = Math.asin(q / qp)

  // Equal Earth forward
  const sinBeta = Math.sin(beta)
  const theta = Math.asin((Math.sqrt(3) / 2) * sinBeta)
  const t = theta
  const t2 = t * t
  const t6 = t2 * t2 * t2

  const denom = 3 * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))
  const x = R * ((2 * Math.sqrt(3) * lam * Math.cos(t)) / denom)
  const y = R * t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2))

  return { x, y }
}

/**
 * Convert Equal Earth coordinates to grid row/col.
 * Returns null if outside the grid bounds.
 */
function xyToCell(x: number, y: number): { row: number; col: number } | null {
  const col = Math.floor((x - ORIGIN_X) / CELL_SIZE)
  const row = Math.floor((ORIGIN_Y - y) / CELL_SIZE)

  if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) {
    return null
  }

  return { row, col }
}

/**
 * Scan a decompressed cell blob and extract monthly data only for requested
 * species codes. Early-exits once all codes are found to avoid unnecessary work.
 */
function parseCellBlob(
  data: ArrayBuffer,
  wanted: Set<string>,
): Map<string, Uint8Array> {
  const view = new Uint8Array(data)
  const result = new Map<string, Uint8Array>()
  const decoder = new TextDecoder()
  let remaining = wanted.size

  for (let offset = 0; offset + RECORD_SIZE <= view.length; offset += RECORD_SIZE) {
    const codeBytes = view.subarray(offset, offset + 8)
    const code = decoder.decode(codeBytes).trimEnd()
    if (wanted.has(code)) {
      result.set(code, view.slice(offset + 8, offset + RECORD_SIZE))
      if (--remaining === 0) break
    }
  }

  return result
}

/**
 * Check if a species is present this month based on monthly data.
 * Uses blending with neighbor months to smooth seasonal boundaries.
 */
function isPresentThisMonth(months: Uint8Array, month: number): boolean {
  const cur = months[month]
  if (cur > 0) return true
  // Check neighbor months - species might be transitioning
  const prev = months[(month + 11) % 12]
  const next = months[(month + 1) % 12]
  return prev > 0 || next > 0
}

/**
 * Check if a species is present in ANY month at this cell.
 */
function isPresentAnyMonth(months: Uint8Array): boolean {
  for (let i = 0; i < 12; i++) {
    if (months[i] > 0) return true
  }
  return false
}

export type RangeResult = {
  /**
   * Where the species stands relative to this location and time:
   * - 'present': BirdLife says species occurs here this season
   * - 'wrong-season': species occurs here but not this time of year
   * - 'out-of-range': species does not occur here at all per BirdLife
   * - 'no-data': no BirdLife data for this location (ocean, grid edge, R2 error)
   */
  status: 'present' | 'wrong-season' | 'out-of-range' | 'no-data'
}

const NO_DATA: RangeResult = { status: 'no-data' }
const PRESENT: RangeResult = { status: 'present' }
const WRONG_SEASON: RangeResult = { status: 'wrong-season' }
const OUT_OF_RANGE: RangeResult = { status: 'out-of-range' }

/**
 * Look up range status for multiple species at a single location/date.
 */
export async function getRangePriors(
  bucket: R2Bucket,
  lat: number,
  lon: number,
  month: number | undefined,
  ebirdCodes: string[],
): Promise<Map<string, RangeResult>> {
  const results = new Map<string, RangeResult>()
  if (ebirdCodes.length === 0) return results

  const { x, y } = lonLatToEqualEarth(lon, lat)
  const cell = xyToCell(x, y)

  if (!cell) {
    for (const code of ebirdCodes) results.set(code, NO_DATA)
    return results
  }

  const key = `range-priors/${cell.row}-${cell.col}.bin.gz`

  try {
    const obj = await bucket.get(key)
    if (!obj) {
      for (const code of ebirdCodes) results.set(code, NO_DATA)
      return results
    }

    const compressed = await obj.arrayBuffer()
    const blob = new Response(
      new Response(compressed).body!.pipeThrough(new DecompressionStream('gzip')),
    )
    const decompressed = await blob.arrayBuffer()
    const wantedSet = new Set(ebirdCodes)
    const speciesMap = parseCellBlob(decompressed, wantedSet)
    const m = month !== undefined && month >= 0 && month <= 11 ? month : new Date().getMonth()

    for (const code of ebirdCodes) {
      const months = speciesMap.get(code)
      if (!months) {
        results.set(code, OUT_OF_RANGE)
      } else if (isPresentThisMonth(months, m)) {
        results.set(code, PRESENT)
      } else if (isPresentAnyMonth(months)) {
        results.set(code, WRONG_SEASON)
      } else {
        results.set(code, OUT_OF_RANGE)
      }
    }
  } catch {
    for (const code of ebirdCodes) results.set(code, NO_DATA)
  }

  return results
}

/**
 * Adjust an LLM confidence score based on BirdLife range data.
 *
 * Multipliers (tunable):
 *   TRUST_PRESENT (1.0):      species expected here this season - full trust
 *   TRUST_WRONG_SEASON (0.6): species occurs here but different season
 *   TRUST_OUT_OF_RANGE (0.35): species not in BirdLife range for this cell
 *   TRUST_NO_DATA (1.0):      no BirdLife data - cannot adjust, full trust
 */
const TRUST_PRESENT = 1.0
const TRUST_WRONG_SEASON = 0.6
const TRUST_OUT_OF_RANGE = 0.35

export function adjustConfidence(confidence: number, range: RangeResult): number {
  switch (range.status) {
    case 'present': return confidence * TRUST_PRESENT
    case 'wrong-season': return confidence * TRUST_WRONG_SEASON
    case 'out-of-range': return confidence * TRUST_OUT_OF_RANGE
    case 'no-data': return confidence
  }
}
