import { describe, it, expect, vi } from 'vitest'
import { adjustConfidence, getRangePriors } from '../../functions/lib/range-filter'
import { gzipSync } from 'zlib'

function makeRecord(code: string, presence: number, origin: number, seasonal: number): Uint8Array {
  const buf = new Uint8Array(11)
  const padded = code.padEnd(8, ' ')
  for (let i = 0; i < 8; i++) buf[i] = padded.charCodeAt(i)
  buf[8] = presence
  buf[9] = origin
  buf[10] = seasonal
  return buf
}

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

const EXTANT = 1
const POSSIBLY_EXTINCT = 4
const NATIVE = 0b000001
const VAGRANT = 0b001000
const RESIDENT = 0b00001
const BREEDING = 0b00010

const SEATTLE_LAT = 47.6
const SEATTLE_LON = -122.3

describe('adjustConfidence', () => {
  it('returns original confidence when no data', () => {
    expect(adjustConfidence(0.80, { status: 'no-data' })).toBe(0.80)
  })

  it('no penalty for extant native resident', () => {
    expect(adjustConfidence(0.80, { status: 'present', presence: EXTANT, origin: NATIVE, seasonal: RESIDENT })).toBe(0.80)
  })

  it('moderate penalty when out of range', () => {
    expect(adjustConfidence(0.80, { status: 'out-of-range' })).toBeCloseTo(0.40)
  })

  it('near-range applies 0.85x base penalty', () => {
    expect(adjustConfidence(0.80, { status: 'near-range', presence: EXTANT, origin: NATIVE, seasonal: RESIDENT })).toBeCloseTo(0.68)
  })

  it('vagrant origin applies 0.85x', () => {
    expect(adjustConfidence(0.80, { status: 'present', presence: EXTANT, origin: VAGRANT, seasonal: RESIDENT })).toBeCloseTo(0.68)
  })

  it('possibly extinct gets 0.8x presence', () => {
    expect(adjustConfidence(1.0, { status: 'present', presence: POSSIBLY_EXTINCT, origin: NATIVE, seasonal: RESIDENT })).toBeCloseTo(0.8)
  })

  it('out-of-season gets 0.9x seasonal', () => {
    expect(adjustConfidence(1.0, { status: 'present', presence: EXTANT, origin: NATIVE, seasonal: BREEDING }, 11, 47.6)).toBeCloseTo(0.9)
  })

  it('in-season breeding returns 1.0', () => {
    expect(adjustConfidence(1.0, { status: 'present', presence: EXTANT, origin: NATIVE, seasonal: BREEDING }, 5, 47.6)).toBe(1.0)
  })

  it('southern hemisphere flips breeding months', () => {
    expect(adjustConfidence(1.0, { status: 'present', presence: EXTANT, origin: NATIVE, seasonal: BREEDING }, 11, -33.0)).toBe(1.0)
    expect(adjustConfidence(1.0, { status: 'present', presence: EXTANT, origin: NATIVE, seasonal: BREEDING }, 5, -33.0)).toBeCloseTo(0.9)
  })

  it('penalties scale proportionally', () => {
    const highConf = adjustConfidence(0.90, { status: 'out-of-range' })
    const lowConf = adjustConfidence(0.45, { status: 'out-of-range' })
    expect(highConf / 0.90).toBeCloseTo(lowConf / 0.45)
  })
})

describe('getRangePriors', () => {
  it('returns present when species is in the blob', async () => {
    const bucket = mockBucket([makeRecord('baleag', EXTANT, NATIVE, RESIDENT)])
    const result = await getRangePriors(bucket, SEATTLE_LAT, SEATTLE_LON, 5, ['baleag'])
    expect(result.get('baleag')).toEqual({ status: 'present', presence: EXTANT, origin: NATIVE, seasonal: RESIDENT })
  })

  it('returns out-of-range for species not in blob or neighbor', async () => {
    const bucket = mockBucket([makeRecord('baleag', EXTANT, NATIVE, RESIDENT)])
    const result = await getRangePriors(bucket, SEATTLE_LAT, SEATTLE_LON, 5, ['norcar'])
    expect(result.get('norcar')).toEqual({ status: 'out-of-range' })
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

  it('returns empty map for empty codes array', async () => {
    const bucket = mockBucket([])
    const result = await getRangePriors(bucket, SEATTLE_LAT, SEATTLE_LON, 5, [])
    expect(result.size).toBe(0)
    expect(bucket.get).not.toHaveBeenCalled()
  })
})

describe('adjustConfidence preserves candidate data through sort', () => {
  it('plumage stays with its species after range-based reordering', async () => {
    const bucket = mockBucket([
      makeRecord('baleag', EXTANT, NATIVE, RESIDENT),
    ])

    type Candidate = { species: string; confidence: number; plumage?: string; ebirdCode: string; rangeStatus?: string }

    let candidates: Candidate[] = [
      { species: 'Northern Cardinal', confidence: 0.85, plumage: 'male', ebirdCode: 'norcar' },
      { species: 'Bald Eagle', confidence: 0.70, plumage: 'juvenile', ebirdCode: 'baleag' },
    ]

    const priors = await getRangePriors(bucket, SEATTLE_LAT, SEATTLE_LON, 5, ['norcar', 'baleag'])
    candidates = candidates.map(c => {
      const range = priors.get(c.ebirdCode)
      if (!range) return c
      return { ...c, confidence: adjustConfidence(c.confidence, range), rangeStatus: range.status }
    })
    candidates.sort((a, b) => b.confidence - a.confidence)

    expect(candidates[0].species).toBe('Bald Eagle')
    expect(candidates[0].plumage).toBe('juvenile')
    expect(candidates[0].rangeStatus).toBe('present')

    expect(candidates[1].species).toBe('Northern Cardinal')
    expect(candidates[1].plumage).toBe('male')
    expect(candidates[1].rangeStatus).toBe('out-of-range')
  })
})
