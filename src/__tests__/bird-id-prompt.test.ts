/**
 * Tests for the bird identification prompt builder (functions/lib/bird-id-prompt.js).
 *
 * This is a pure function with no Cloudflare type dependencies, so it can
 * be tested directly from the client-side test runner.
 */
import { describe, it, expect } from 'vitest'
import { buildBirdIdPrompt } from '../../functions/lib/bird-id-prompt.js'

describe('buildBirdIdPrompt', () => {
  it('generates a prompt without context when no parameters given', () => {
    const prompt = buildBirdIdPrompt(undefined, undefined, undefined)
    expect(prompt).toContain('Identify birds in this image')
    expect(prompt).not.toContain('Context:')
  })

  it('includes GPS coordinates when location is provided', () => {
    const prompt = buildBirdIdPrompt({ lat: 47.6606, lon: -122.4147 }, undefined, undefined)
    expect(prompt).toContain('GPS 47.6606, -122.4147')
    expect(prompt).toContain('Primary geolocation (authoritative)')
  })

  it('includes month name when month is provided', () => {
    const prompt = buildBirdIdPrompt(undefined, 0, undefined)
    expect(prompt).toContain('Month: Jan')
  })

  it('formats month correctly for all months', () => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    for (let i = 0; i < 12; i++) {
      const prompt = buildBirdIdPrompt(undefined, i, undefined)
      expect(prompt).toContain(`Month: ${months[i]}`)
    }
  })

  it('includes location name as secondary context', () => {
    const prompt = buildBirdIdPrompt(undefined, undefined, 'Central Park, New York')
    expect(prompt).toContain('Place label (secondary, may be noisy): Central Park, New York')
  })

  it('includes all context when all parameters are provided', () => {
    const prompt = buildBirdIdPrompt({ lat: 40.7829, lon: -73.9654 }, 5, 'Central Park')
    expect(prompt).toContain('Context:')
    expect(prompt).toContain('GPS 40.7829, -73.9654')
    expect(prompt).toContain('Month: Jun')
    expect(prompt).toContain('Central Park')
  })

  it('always includes JSON output format instructions', () => {
    const prompt = buildBirdIdPrompt(undefined, undefined, undefined)
    expect(prompt).toContain('Output JSON only')
    expect(prompt).toContain('candidates')
    expect(prompt).toContain('birdCenter')
    expect(prompt).toContain('multipleBirds')
  })

  it('instructs to return confidence scores', () => {
    const prompt = buildBirdIdPrompt(undefined, undefined, undefined)
    expect(prompt).toContain('confidence')
    expect(prompt).toContain('0.90-1.00')
  })
})
