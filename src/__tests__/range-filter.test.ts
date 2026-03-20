import { describe, it, expect, vi } from 'vitest'
import { adjustConfidence, getRangePriors } from '../../functions/lib/range-filter'
import { gzipSync } from 'zlib'

/** Build a 20-byte record: 8-byte padded code + 12 uint8 monthly values. */
function makeRecord(code: string, months: number[]): Uint8Array {
  const buf = new Uint8Array(20)
  const padded = code.padEnd(8, ' ')
  for (let i = 0; i < 8; i++) buf[i] = padded.charCodeAt(i)
  for (let i = 0; i < 12; i++) buf[8 + i] = months[i] ?? 0
  return buf
}

/** Build a gzipped cell blob from species records and wrap as a mock R2Bucket. */
function mockBucket(records: Uint8Array[]): any {
  const raw = new Uint8Array(records.reduce((n, r) => n + r.length, 0))
  let offset = 0
  for (const r of records) { raw.set(r, offset); offset += r.length }
  const compressed = gzipSync(Buffer.from(raw))

  return {
    get: vi.fn(async () => ({
      arrayBuffer: async () => compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength),
    })),
  }
}

function emptyBucket(): any {
  return { get: vi.fn(async () => null) }
}

// Seattle: lat=47.6, lon=-122.3 - known to be within grid bounds
const SEATTLE_LAT = 47.6
const SEATTLE_LON = -122.3

describe('adjustConfidence', () => {
  it('returns original confidence when no data', () => {
    expect(adjustConfidence(0.80, { status: 'no-data' })).toBe(0.80)
  })

  it('no penalty when species is present this season', () => {
    expect(adjustConfidence(0.80, { status: 'present' })).toBe(0.80)
    expect(adjustConfidence(0.92, { status: 'present' })).toBe(0.92)
  })

  it('moderate penalty when wrong season', () => {
    // 0.80 * 0.6 = 0.48
    expect(adjustConfidence(0.80, { status: 'wrong-season' })).toBeCloseTo(0.48)
  })

  it('strong penalty when out of range', () => {
    // 0.80 * 0.35 = 0.28
    expect(adjustConfidence(0.80, { status: 'out-of-range' })).toBeCloseTo(0.28)
  })

  it('penalties scale proportionally with confidence', () => {
    const highConf = adjustConfidence(0.90, { status: 'out-of-range' })
    const lowConf = adjustConfidence(0.45, { status: 'out-of-range' })
    expect(highConf / 0.90).toBeCloseTo(lowConf / 0.45)
  })
})

describe('getRangePriors', () => {
  // Present in June (month 5) only
  const juneOnly = [0, 0, 0, 0, 0, 128, 0, 0, 0, 0, 0, 0]
  // Present year-round
  const yearRound = Array(12).fill(128)

  it('returns present when species has data for the requested month', async () => {
    const bucket = mockBucket([makeRecord('baleag', yearRound)])
    const result = await getRangePriors(bucket, SEATTLE_LAT, SEATTLE_LON, 5, ['baleag'])
    expect(result.get('baleag')).toEqual({ status: 'present' })
  })

  it('returns out-of-range for species not in the blob', async () => {
    const bucket = mockBucket([makeRecord('baleag', yearRound)])
    const result = await getRangePriors(bucket, SEATTLE_LAT, SEATTLE_LON, 5, ['norcar'])
    expect(result.get('norcar')).toEqual({ status: 'out-of-range' })
  })

  it('returns wrong-season when species exists but not this month', async () => {
    const bucket = mockBucket([makeRecord('baleag', juneOnly)])
    // Query for January (month 11 = December, no neighbor overlap with June)
    const result = await getRangePriors(bucket, SEATTLE_LAT, SEATTLE_LON, 9, ['baleag'])
    expect(result.get('baleag')).toEqual({ status: 'wrong-season' })
  })

  it('neighbor-month smoothing marks species present at season boundary', async () => {
    const bucket = mockBucket([makeRecord('baleag', juneOnly)])
    // Month 4 (May) is neighbor to month 5 (June) which has data
    const result = await getRangePriors(bucket, SEATTLE_LAT, SEATTLE_LON, 4, ['baleag'])
    expect(result.get('baleag')).toEqual({ status: 'present' })
  })

  it('returns no-data when bucket.get returns null', async () => {
    const bucket = emptyBucket()
    const result = await getRangePriors(bucket, SEATTLE_LAT, SEATTLE_LON, 5, ['baleag'])
    expect(result.get('baleag')).toEqual({ status: 'no-data' })
  })

  it('returns no-data when bucket.get throws', async () => {
    const bucket = { get: vi.fn(async () => { throw new Error('R2 error') }) }
    const result = await getRangePriors(bucket as any, SEATTLE_LAT, SEATTLE_LON, 5, ['baleag'])
    expect(result.get('baleag')).toEqual({ status: 'no-data' })
  })

  it('handles multiple species in one query', async () => {
    const bucket = mockBucket([
      makeRecord('baleag', yearRound),
      makeRecord('norcar', juneOnly),
    ])
    const result = await getRangePriors(bucket, SEATTLE_LAT, SEATTLE_LON, 0, ['baleag', 'norcar', 'amecro'])
    expect(result.get('baleag')).toEqual({ status: 'present' })
    expect(result.get('norcar')).toEqual({ status: 'wrong-season' })
    expect(result.get('amecro')).toEqual({ status: 'out-of-range' })
  })

  it('returns empty map for empty codes array', async () => {
    const bucket = mockBucket([])
    const result = await getRangePriors(bucket, SEATTLE_LAT, SEATTLE_LON, 5, [])
    expect(result.size).toBe(0)
    expect(bucket.get).not.toHaveBeenCalled()
  })
})
