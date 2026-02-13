import { describe, it, expect } from 'vitest'
import { getDisplayName, getScientificName } from '@/lib/utils'

describe('getDisplayName', () => {
  it('extracts common name from "Common Name (Scientific name)"', () => {
    expect(getDisplayName('Northern Cardinal (Cardinalis cardinalis)')).toBe('Northern Cardinal')
  })

  it('returns the full string unchanged when there are no parentheses', () => {
    expect(getDisplayName('Blue Jay')).toBe('Blue Jay')
  })

  it('trims whitespace around the common name', () => {
    expect(getDisplayName('  House Sparrow (Passer domesticus)  ')).toBe('House Sparrow')
  })

  it('handles empty string', () => {
    expect(getDisplayName('')).toBe('')
  })

  it('handles species with nested parentheses by splitting at the first (', () => {
    expect(getDisplayName('Cooper\'s Hawk (Accipiter cooperii)')).toBe('Cooper\'s Hawk')
  })
})

describe('getScientificName', () => {
  it('extracts scientific name from parentheses', () => {
    expect(getScientificName('Northern Cardinal (Cardinalis cardinalis)')).toBe('Cardinalis cardinalis')
  })

  it('returns undefined when there are no parentheses', () => {
    expect(getScientificName('Blue Jay')).toBeUndefined()
  })

  it('returns undefined for empty string', () => {
    expect(getScientificName('')).toBeUndefined()
  })

  it('extracts from first matching parenthesized group', () => {
    expect(getScientificName('Red-tailed Hawk (Buteo jamaicensis)')).toBe('Buteo jamaicensis')
  })
})
