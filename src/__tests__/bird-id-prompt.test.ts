/**
 * Tests for the bird identification prompt builder (functions/lib/bird-id-prompt.js).
 *
 * This is a pure function with no Cloudflare type dependencies, so it can
 * be tested directly from the client-side test runner.
 */
import { describe, it, expect } from 'vitest'
import { buildBirdIdPrompt, BIRD_ID_INSTRUCTIONS, BIRD_ID_SCHEMA } from '../../functions/lib/bird-id-prompt.js'

describe('buildBirdIdPrompt', () => {
  it('generates a prompt without context when no parameters given', () => {
    const prompt = buildBirdIdPrompt(undefined, undefined)
    expect(prompt).toContain('Identify birds in this image')
    expect(prompt).not.toContain('Context:')
  })

  it('includes GPS coordinates when location is provided', () => {
    const prompt = buildBirdIdPrompt({ lat: 47.6606, lon: -122.4147 }, undefined)
    expect(prompt).toContain('47.6606, -122.4147')
  })

  it('includes month name when month is provided', () => {
    const prompt = buildBirdIdPrompt(undefined, 0)
    expect(prompt).toContain('Month: Jan')
  })

  it('formats month correctly for all months', () => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    for (let i = 0; i < 12; i++) {
      const prompt = buildBirdIdPrompt(undefined, i)
      expect(prompt).toContain(`Month: ${months[i]}`)
    }
  })

  it('includes all context when all parameters are provided', () => {
    const prompt = buildBirdIdPrompt({ lat: 40.7829, lon: -73.9654 }, 5)
    expect(prompt).toContain('Context:')
    expect(prompt).toContain('40.7829, -73.9654')
    expect(prompt).toContain('Month: Jun')
  })
})

describe('BIRD_ID_INSTRUCTIONS', () => {
  it('contains identification rules and format spec', () => {
    expect(BIRD_ID_INSTRUCTIONS).toContain('candidates')
    expect(BIRD_ID_INSTRUCTIONS).toContain('birdCenter')
    expect(BIRD_ID_INSTRUCTIONS).toContain('multipleBirds')
    expect(BIRD_ID_INSTRUCTIONS).toContain('confidence')
    expect(BIRD_ID_INSTRUCTIONS).toContain('0.90-1.00')
  })
})

describe('BIRD_ID_SCHEMA', () => {
  it('is a valid json_schema format spec', () => {
    expect(BIRD_ID_SCHEMA.type).toBe('json_schema')
    expect(BIRD_ID_SCHEMA.strict).toBe(true)
    const candidateProps = BIRD_ID_SCHEMA.schema.properties.candidates.items.properties
    expect(candidateProps.commonName).toBeDefined()
    expect(candidateProps.scientificName).toBeDefined()
    expect(candidateProps.confidence.minimum).toBe(0)
    expect(candidateProps.confidence.maximum).toBe(1)
    expect(candidateProps.plumage.enum).toEqual(['male', 'female', 'juvenile', null])
    expect(BIRD_ID_SCHEMA.schema.required).toContain('candidates')
    expect(BIRD_ID_SCHEMA.schema.required).toContain('multipleBirds')
  })
})
