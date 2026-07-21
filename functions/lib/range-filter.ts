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
  neighborCells,
  parseCellBlob,
  adjustConfidence as _adjustConfidence,
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
 * For species not found in the primary cell, scans the full 3x3 ring of
 * neighbor cells (up to 8) in parallel, closest-first, and upgrades a species
 * to 'near-range' on the first neighbor cell that contains it. Species absent
 * from the primary cell and every neighbor are marked 'out-of-range'.
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

    // Neighbor blending for out-of-range species. Scan the full 3x3 ring
    // (up to 8 cells) rather than only the single closest edge cell: coastal
    // and range-edge points often fall in a cell that lacks a species whose
    // BirdLife polygon covers an adjacent (frequently diagonal) cell, which
    // the old single-neighbor lookup reported as out-of-range. Cells are
    // fetched in parallel and scanned closest-first; a species is marked
    // near-range on the first ring cell that contains it.
    if (outOfRange.length > 0) {
      const neighbors = neighborCells(x, y, cell.row, cell.col)
      const remaining = new Set(outOfRange)
      // Progressive fan-out: process the ring in closest-first waves and only
      // fetch farther cells if species are still unresolved. Coastal points
      // are usually resolved by the 1-2 nearest cells, so this avoids issuing
      // all 8 R2 GETs on the hot path while preserving closest-first winner
      // semantics. Within a wave, cells are fetched in parallel (network
      // latency dominates) and decompressed lazily closest-first with early
      // exit. Worst case is a handful of small waves rather than 8 GETs.
      const WAVE_SIZE = 2
      for (let i = 0; i < neighbors.length && remaining.size > 0; i += WAVE_SIZE) {
        const wave = neighbors.slice(i, i + WAVE_SIZE)
        const waveBlobs = await Promise.all(
          wave.map(async n => {
            try {
              const nObj = await bucket.get(`range-priors/${n.row}-${n.col}.bin.gz`)
              if (!nObj) return null
              return await nObj.arrayBuffer()
            } catch {
              return null
            }
          }),
        )
        // Scan closest-first within the wave so the nearest containing cell wins.
        for (const blob of waveBlobs) {
          if (remaining.size === 0) break
          if (!blob) continue
          let nData: Uint8Array
          try {
            nData = new Uint8Array(await decompressBlob(blob))
          } catch {
            continue
          }
          const nMap = parseCellBlob(nData, remaining)
          for (const code of [...remaining]) {
            const attrs = nMap.get(code)
            if (attrs) {
              results.set(code, { status: 'near-range', ...attrs })
              remaining.delete(code)
            }
          }
        }
      }
      for (const code of remaining) results.set(code, OUT_OF_RANGE)
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
