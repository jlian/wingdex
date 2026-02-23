import { describe, expect, it } from 'vitest'
import {
  generateBirdName,
  emojiForBirdName,
  emojiAvatarDataUrl,
  getEmojiAvatarColor,
} from '@/lib/fun-names'

describe('generateBirdName', () => {
  it('returns a three-part kebab-case string', () => {
    const name = generateBirdName()
    const parts = name.split('-')
    expect(parts.length).toBe(3)
    expect(parts.every((p) => p.length > 0)).toBe(true)
  })

  it('produces different names on repeated calls', () => {
    const names = new Set(Array.from({ length: 20 }, () => generateBirdName()))
    expect(names.size).toBeGreaterThan(1)
  })
})

describe('emojiForBirdName', () => {
  it('maps eagle names to the eagle emoji', () => {
    expect(emojiForBirdName('bold-canyon-eagle')).toBe('🦅')
    expect(emojiForBirdName('calm-forest-hawk')).toBe('🦅')
  })

  it('maps owl to the owl emoji', () => {
    expect(emojiForBirdName('wise-cedar-owl')).toBe('🦉')
  })

  it('maps penguin to the penguin emoji', () => {
    expect(emojiForBirdName('happy-arctic-penguin')).toBe('🐧')
  })

  it('maps flamingo to the flamingo emoji', () => {
    expect(emojiForBirdName('rosy-lake-flamingo')).toBe('🦩')
  })

  it('maps finch/sparrow to the chick emoji', () => {
    expect(emojiForBirdName('tiny-meadow-finch')).toBe('🐤')
    expect(emojiForBirdName('nimble-ridge-sparrow')).toBe('🐤')
  })

  it('falls back to generic bird emoji for unmapped words', () => {
    expect(emojiForBirdName('clever-sky-cardinal')).toBe('🐦')
  })

  it('falls back to generic bird emoji for unknown bird', () => {
    expect(emojiForBirdName('fancy-lake-unknown')).toBe('🐦')
  })
})

describe('emojiAvatarDataUrl', () => {
  it('returns a data URI containing the emoji', () => {
    const url = emojiAvatarDataUrl('🦉')
    expect(url).toMatch(/^data:image\/svg\+xml;utf8,/)
    expect(decodeURIComponent(url)).toContain('🦉')
  })

  it('returns different URIs for different emojis', () => {
    expect(emojiAvatarDataUrl('🦉')).not.toBe(emojiAvatarDataUrl('🐧'))
  })
})

describe('getEmojiAvatarColor', () => {
  it('returns the correct color class for an emoji avatar', () => {
    const owlUrl = emojiAvatarDataUrl('🦉')
    expect(getEmojiAvatarColor(owlUrl)).toBe('bg-amber-100 dark:bg-amber-900/40')
  })

  it('returns the correct color for penguin emoji', () => {
    const penguinUrl = emojiAvatarDataUrl('🐧')
    expect(getEmojiAvatarColor(penguinUrl)).toBe('bg-slate-100 dark:bg-slate-600/50')
  })

  it('returns empty string for non-emoji image URLs', () => {
    expect(getEmojiAvatarColor('https://avatars.github.com/u/123')).toBe('')
  })

  it('returns empty string for null/undefined', () => {
    expect(getEmojiAvatarColor(null)).toBe('')
    expect(getEmojiAvatarColor(undefined)).toBe('')
  })

  it('returns empty string for empty string', () => {
    expect(getEmojiAvatarColor('')).toBe('')
  })
})
