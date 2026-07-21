import { describe, it, expect, vi } from 'vitest'
import { gzipSync } from 'zlib'
import { onRequestPost } from '../../functions/api/range-adjust'

// ---- helpers to build a fake R2 range-prior bucket ----
function makeRecord(code: string, presence: number, origin: number, seasonal: number): Uint8Array {
  const buf = new Uint8Array(11)
  const padded = code.padEnd(8, ' ')
  for (let i = 0; i < 8; i++) buf[i] = padded.charCodeAt(i)
  buf[8] = presence
  buf[9] = origin
  buf[10] = seasonal
  return buf
}

function cellBlob(records: Uint8Array[]): Buffer {
  const raw = new Uint8Array(records.reduce((n, r) => n + r.length, 0))
  let offset = 0
  for (const r of records) { raw.set(r, offset); offset += r.length }
  return gzipSync(Buffer.from(raw))
}

/**
 * R2 bucket that returns the given records for the FIRST cell key requested
 * (the self cell) and null for every subsequent distinct key (neighbors =
 * ocean/empty). This lets tests exercise self-cell vs neighbor behavior
 * instead of returning the same blob for every key.
 */
function bucketWith(records: Uint8Array[]): any {
  const compressed = cellBlob(records)
  let selfKey: string | null = null
  return {
    get: vi.fn(async (key: string) => {
      if (selfKey === null) selfKey = key // first requested cell = self
      if (key !== selfKey) return null // neighbor cells are empty
      return {
        arrayBuffer: async () => compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength),
      }
    }),
  }
}

const EXTANT = 1, NATIVE = 0b000001, RESIDENT = 0b00001

function makeContext(body: unknown, bucket: any, user: { id: string; isAnonymous: boolean } | undefined = { id: 'u1', isAnonymous: false }): any {
  return {
    request: { json: async () => body },
    env: { RANGE_PRIORS: bucket },
    data: { user, log: undefined },
  }
}

const SEATTLE = { lat: 47.6, lon: -122.3 }

describe('POST /api/range-adjust', () => {
  it('401 when unauthenticated', async () => {
    const ctx: any = {
      request: { json: async () => ({ candidates: [] }) },
      env: { RANGE_PRIORS: bucketWith([]) },
      data: { log: undefined }, // no user
    }
    const res = await onRequestPost(ctx)
    expect(res.status).toBe(401)
  })

  it('403 for anonymous users', async () => {
    const res = await onRequestPost(makeContext({ candidates: [] }, bucketWith([]), { id: 'u1', isAnonymous: true }))
    expect(res.status).toBe(403)
  })

  it('400 when candidates is not an array', async () => {
    const res = await onRequestPost(makeContext({ candidates: 'nope' }, bucketWith([])))
    expect(res.status).toBe(400)
  })

  it('grounds candidates to taxonomy and returns canonical species names', async () => {
    const body = {
      candidates: [{ commonName: 'Bald Eagle', scientificName: 'Haliaeetus leucocephalus', confidence: 0.9 }],
    }
    const res = await onRequestPost(makeContext(body, bucketWith([])))
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.candidates[0].species).toMatch(/Bald Eagle/)
  })

  it('drops candidates that do not match the taxonomy', async () => {
    // A scientific-name-only lookup with gibberish that can't match any taxon.
    const body = { candidates: [{ commonName: 'Zzzxqwv', scientificName: 'Qwxzzz plfgh', confidence: 0.9 }] }
    const res = await onRequestPost(makeContext(body, bucketWith([])))
    const json = await res.json() as any
    expect(json.candidates.length).toBe(0)
  })

  it('trusts a dominant top candidate without range reranking', async () => {
    // Bald Eagle dominant (0.95 vs 0.10): gate keeps raw order even if range absent.
    const body = {
      candidates: [
        { commonName: 'Bald Eagle', scientificName: 'Haliaeetus leucocephalus', confidence: 0.95 },
        { commonName: 'Golden Eagle', scientificName: 'Aquila chrysaetos', confidence: 0.10 },
      ],
      ...SEATTLE,
    }
    const bucket = bucketWith([])
    const res = await onRequestPost(makeContext(body, bucket))
    const json = await res.json() as any
    expect(json.candidates[0].species).toMatch(/Bald Eagle/)
    // Dominance gate short-circuits: range bucket should not be consulted.
    expect(bucket.get).not.toHaveBeenCalled()
  })

  it('tiers ambiguous candidates by range: in-range beats out-of-range', async () => {
    // Two close candidates; only the first (baleag) is in-range in the blob.
    const body = {
      candidates: [
        { commonName: 'Northern Cardinal', scientificName: 'Cardinalis cardinalis', confidence: 0.40 },
        { commonName: 'Bald Eagle', scientificName: 'Haliaeetus leucocephalus', confidence: 0.38 },
      ],
      ...SEATTLE,
    }
    // Blob contains only baleag => cardinal is out-of-range, eagle present.
    const bucket = bucketWith([makeRecord('baleag', EXTANT, NATIVE, RESIDENT)])
    const res = await onRequestPost(makeContext(body, bucket))
    const json = await res.json() as any
    expect(json.rangeAdjusted).toBe(true)
    // Bald Eagle (in-range) should be tiered above the out-of-range cardinal
    // despite slightly lower raw confidence.
    expect(json.candidates[0].species).toMatch(/Bald Eagle/)
  })

  it('skips range adjustment when no location is provided', async () => {
    const body = {
      candidates: [
        { commonName: 'Northern Cardinal', scientificName: 'Cardinalis cardinalis', confidence: 0.40 },
        { commonName: 'Bald Eagle', scientificName: 'Haliaeetus leucocephalus', confidence: 0.38 },
      ],
    }
    const bucket = bucketWith([makeRecord('baleag', EXTANT, NATIVE, RESIDENT)])
    const res = await onRequestPost(makeContext(body, bucket))
    const json = await res.json() as any
    expect(json.rangeAdjusted).toBeUndefined()
    expect(bucket.get).not.toHaveBeenCalled()
    // Raw order preserved (cardinal first).
    expect(json.candidates[0].species).toMatch(/Cardinal/)
  })

  it('rejects oversized candidate lists', async () => {
    const many = Array.from({ length: 51 }, () => ({ commonName: 'Bald Eagle', confidence: 0.5 }))
    const res = await onRequestPost(makeContext({ candidates: many }, bucketWith([])))
    expect(res.status).toBe(400)
  })
})
