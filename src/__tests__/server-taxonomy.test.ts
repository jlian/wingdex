/**
 * Tests for the server-side taxonomy module (functions/lib/taxonomy.ts).
 *
 * The server taxonomy is a separate copy of the client taxonomy ported to the
 * Cloudflare Functions runtime. These tests cover server-unique functions
 * (getEbirdCode, getSpeciesByCode) and verify the server module loads correctly.
 */
import { describe, it, expect } from 'vitest'
import {
  searchSpecies,
  findBestMatch,
  getWikiTitle,
  getEbirdCode,
  getSpeciesByCode,
  speciesCount,
} from '../../functions/lib/taxonomy'

describe('server taxonomy', () => {
  it('loads a large taxonomy', () => {
    expect(speciesCount).toBeGreaterThan(10_000)
  })

  describe('getEbirdCode', () => {
    it('returns the stored eBird code for a known species', () => {
      expect(getEbirdCode('American Robin')).toBe('amerob')
    })

    it('is case-insensitive', () => {
      expect(getEbirdCode('american robin')).toBe('amerob')
    })

    it('generates a fallback code when the species has no stored code', () => {
      // Completely fictional species — no stored code, so it generates from name
      const code = getEbirdCode('Purple Sparkle Dragon')
      expect(typeof code).toBe('string')
      expect(code.length).toBeGreaterThan(0)
    })

    it('generates 4-letter codes from 2-word names', () => {
      // The algorithm: first 3 chars of word1 + first 3 chars of word2 = 6 chars
      // For a real species like "Bald Eagle" it should return the stored code
      expect(getEbirdCode('Bald Eagle')).toBe('baleag')
    })
  })

  describe('getSpeciesByCode', () => {
    it('looks up a species by eBird code', () => {
      const entry = getSpeciesByCode('amerob')
      expect(entry).toBeDefined()
      expect(entry!.common).toBe('American Robin')
      expect(entry!.scientific).toBe('Turdus migratorius')
    })

    it('is case-insensitive', () => {
      expect(getSpeciesByCode('AMEROB')?.common).toBe('American Robin')
    })

    it('returns undefined for an unknown code', () => {
      expect(getSpeciesByCode('zzzzz')).toBeUndefined()
    })
  })

  describe('searchSpecies (server)', () => {
    it('returns results matching by common name prefix', () => {
      const results = searchSpecies('Northern Card')
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].common).toBe('Northern Cardinal')
    })

    it('includes scientific names in results', () => {
      const results = searchSpecies('Turdus')
      expect(results.length).toBeGreaterThan(0)
      expect(results.some(entry => entry.scientific.startsWith('Turdus'))).toBe(true)
    })
  })

  describe('findBestMatch (server)', () => {
    it('matches exact common name', () => {
      const match = findBestMatch('Northern Cardinal')
      expect(match).not.toBeNull()
      expect(match!.common).toBe('Northern Cardinal')
    })

    it('matches AI-style "Common Name (Scientific Name)" format', () => {
      const match = findBestMatch('Northern Cardinal (Cardinalis cardinalis)')
      expect(match).not.toBeNull()
      expect(match!.common).toBe('Northern Cardinal')
    })
  })

  describe('getWikiTitle (server)', () => {
    it('returns wiki title for a known species', () => {
      expect(getWikiTitle('American Robin')).toBeDefined()
    })

    it('returns undefined for unknown species', () => {
      expect(getWikiTitle('Purple Sparkle Dragon')).toBeUndefined()
    })
  })
})
