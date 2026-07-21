import { describe, expect, it } from 'vitest'
import { chunkIds, queryInChunks } from '../../functions/lib/d1-chunk'

describe('chunkIds', () => {
  it('returns empty array for empty input', () => {
    expect(chunkIds([])).toEqual([])
  })

  it('keeps small lists in a single chunk', () => {
    expect(chunkIds([1, 2, 3], 90)).toEqual([[1, 2, 3]])
  })

  it('splits lists larger than the chunk size', () => {
    const ids = Array.from({ length: 200 }, (_, i) => i)
    const chunks = chunkIds(ids, 90)
    expect(chunks.map(c => c.length)).toEqual([90, 90, 20])
    expect(chunks.flat()).toEqual(ids)
  })

  it('rejects invalid chunk sizes', () => {
    expect(() => chunkIds([1], 0)).toThrow()
  })
})

describe('queryInChunks', () => {
  it('runs one query per chunk and concatenates rows within the D1 param limit', async () => {
    const ids = Array.from({ length: 205 }, (_, i) => i)
    const seenPlaceholderLengths: number[] = []
    const rows = await queryInChunks(ids, async (chunk, placeholders) => {
      // placeholders binds one '?' per id; plus a leading userId stays <= 100
      seenPlaceholderLengths.push(placeholders.split(',').length)
      return chunk.map(id => ({ id }))
    })
    expect(rows.map(r => r.id)).toEqual(ids)
    expect(seenPlaceholderLengths).toEqual([90, 90, 25])
    expect(Math.max(...seenPlaceholderLengths) + 1).toBeLessThanOrEqual(100)
  })

  it('makes no query for empty input', async () => {
    let calls = 0
    const rows = await queryInChunks<number, number>([], async () => {
      calls++
      return []
    })
    expect(rows).toEqual([])
    expect(calls).toBe(0)
  })
})
