/**
 * Range-prior filter: adjusts bird-ID confidence using BirdLife International
 * species distribution data stored as pre-computed per-cell blobs in R2.
 *
 * Pure logic (projection, grid math, confidence adjustment) lives in
 * range-adjust.js so offline scripts can reuse it without duplication.
 * This module adds R2 I/O, decompression, and neighbor-cell blending.
 */

import {
  lonLatToEqualEarth,
  xyToCell,
  nearestNeighborCell,
  parseCellBlob,
  adjustConfidence as _adjustConfidence,
  RECORD_SIZE,
  GRID_ORIGIN_X,
  GRID_ORIGIN_Y,
  GRID_CELL_SIZE,
  GRID_COLS,
  GRID_ROWS,
} from './range-adjust.js'

export type RangeResult = {
  status: 'present' | 'near-range' | 'out-of-range' | 'no-data'
  presence?: number
  origin?: number
  seasonal?: number
}

const NO_DATA: RangeResult = { status: 'no-data' }
const OUT_OF_RANGE: RangeResult = { status: 'out-of-range' }

async function decompressBlob(compressed: ArrayBuffer): Promise<ArrayBuffer> {
  const blob = new Response(
    new Response(compressed).body!.pipeThrough(new DecompressionStream('gzip')),
  )
  return blob.arrayBuffer()
}

/**
 * Look up range status for multiple species at a single location.
 *
 * For species not found in the primary cell, checks the nearest neighbor
 * cell (based on point position) and upgrades those to 'near-range'.
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

  try {
    const obj = await bucket.get(`range-priors/${cell.row}-${cell.col}.bin.gz`)
    if (!obj) {
      for (const code of ebirdCodes) results.set(code, NO_DATA)
      return results
    }

    const decompressed = await decompressBlob(await obj.arrayBuffer())
    const wantedSet = new Set(ebirdCodes)
    const speciesMap = parseCellBlob(new Uint8Array(decompressed), wantedSet)

    const outOfRange: string[] = []
    for (const code of ebirdCodes) {
      const attrs = speciesMap.get(code)
      if (attrs) {
        results.set(code, { status: 'present', ...attrs })
      } else {
        outOfRange.push(code)
      }
    }

    // Neighbor blending for out-of-range species
    if (outOfRange.length > 0) {
      const neighbor = nearestNeighborCell(x, y, cell.row, cell.col)
      if (neighbor) {
        try {
          const nObj = await bucket.get(`range-priors/${neighbor.row}-${neighbor.col}.bin.gz`)
          if (nObj) {
            const nData = await decompressBlob(await nObj.arrayBuffer())
            const nMap = parseCellBlob(new Uint8Array(nData), new Set(outOfRange))
            for (const code of outOfRange) {
              const attrs = nMap.get(code)
              results.set(code, attrs ? { status: 'near-range', ...attrs } : OUT_OF_RANGE)
            }
          } else {
            for (const code of outOfRange) results.set(code, OUT_OF_RANGE)
          }
        } catch {
          for (const code of outOfRange) results.set(code, OUT_OF_RANGE)
        }
      } else {
        for (const code of outOfRange) results.set(code, OUT_OF_RANGE)
      }
    }
  } catch {
    for (const code of ebirdCodes) results.set(code, NO_DATA)
  }

  return results
}

/** Re-export adjustConfidence with proper TS types. */
export function adjustConfidence(
  confidence: number,
  range: RangeResult,
  month?: number,
  lat?: number,
): number {
  return _adjustConfidence(confidence, range, month, lat)
}
