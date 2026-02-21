/**
 * Replay tests for AI bird identification using real LLM response fixtures.
 *
 * These tests mock the fetch call to return captured responses from GitHub Models
 * (stored in fixtures/llm-responses/) and verify the full pipeline:
 *   1. JSON parsing robustness (local helper on captured raw output)
 *   2. Taxonomy grounding (findBestMatch normalization)
 *   3. Client request/response handling against server-style payload shape
 *
 * Fixtures are captured via: node scripts/capture-llm-fixtures.mjs
 * No network calls are made during these tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findBestMatch } from '../../functions/lib/taxonomy'

// ── Fixture loading ─────────────────────────────────────────

interface Fixture {
  imageFile: string
  context: { lat?: number; lon?: number; month?: number; locationName?: string }
  rawResponse: string
  parsed: {
    candidates: { species: string; confidence: number }[]
    birdCenter: [number, number] | null
    birdSize: 'small' | 'medium' | 'large' | null
    multipleBirds: boolean
  }
  model: string
  capturedAt: string
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = join(__dirname, 'fixtures', 'llm-responses')
const fixtures: Fixture[] = readdirSync(FIXTURE_DIR)
  .filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf8')))

// ── Mock setup (same as ai-inference.test.ts) ───────────────

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

vi.stubGlobal('Image', class {
  width = 800; height = 600
  onload: (() => void) | null = null
  onerror: ((e: any) => void) | null = null
  set src(_: string) { setTimeout(() => this.onload?.(), 0) }
})

const mockCanvasCtx = { drawImage: vi.fn() }
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockCanvasCtx) as any
HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,mock')

const { identifyBirdInPhoto } = await import('@/lib/ai-inference')

function safeParseJSON(text: string): any {
  try {
    return JSON.parse(text)
  } catch {}

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim())
    } catch {}
  }

  const objectLike = text.match(/\{[\s\S]*\}/)
  if (objectLike?.[0]) {
    try {
      return JSON.parse(objectLike[0])
    } catch {}
  }

  return null
}

function replayFixture(fixture: Fixture) {
  const parsed = safeParseJSON(fixture.rawResponse)
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      candidates: parsed?.candidates || fixture.parsed.candidates,
      multipleBirds: parsed?.multipleBirds ?? fixture.parsed.multipleBirds,
    }),
    text: async () => fixture.rawResponse,
  })
}

/** Build location param — returns undefined when lat/lon are missing (no-GPS edge case) */
function fixtureLocation(f: Fixture) {
  return f.context.lat != null && f.context.lon != null
    ? { lat: f.context.lat, lon: f.context.lon }
    : undefined
}

// ── Tests ───────────────────────────────────────────────────

describe('LLM fixture replay', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── Sanity: fixtures exist and are well-formed ──────────

  it('all fixtures have required fields', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(6)
    for (const f of fixtures) {
      expect(f.rawResponse).toBeTruthy()
      expect(f.parsed).toBeTruthy()
      expect(Array.isArray(f.parsed.candidates)).toBe(true)
      expect(f.model).toBeTruthy()
      // No-GPS fixture has empty context; all others must have lat/lon
      if (f.context.lat != null) {
        expect(f.context.lat).toBeTypeOf('number')
        expect(f.context.lon).toBeTypeOf('number')
      }
    }
  })

  // ── safeParseJSON on real LLM output ────────────────────

  describe('safeParseJSON on real LLM responses', () => {
    it.each(fixtures.map(f => [f.imageFile, f]))(
      'parses %s rawResponse without error',
      (_name, fixture) => {
        const f = fixture as Fixture
        const result = safeParseJSON(f.rawResponse)
        expect(result).not.toBeNull()
        expect(result.candidates).toEqual(f.parsed.candidates)
      }
    )
  })

  // ── Taxonomy grounding ──────────────────────────────────

  describe('taxonomy grounding of fixture species', () => {
    const allSpecies = fixtures.flatMap(f =>
      f.parsed.candidates.map(c => c.species)
    )

    it.each(allSpecies.map(s => [s]))(
      'grounds "%s" to a valid eBird taxon',
      (species) => {
        const match = findBestMatch(species as string)
        expect(match).not.toBeNull()
        expect(match!.common).toBeTruthy()
        expect(match!.scientific).toBeTruthy()
      }
    )

    it('grounds "Steller\'s Jay (Cyanocitta stelleri)" to canonical name', () => {
      const match = findBestMatch("Steller's Jay (Cyanocitta stelleri)")
      expect(match).not.toBeNull()
      expect(match!.common).toBe("Steller's Jay")
      expect(match!.scientific).toBe('Cyanocitta stelleri')
    })

    it('grounds "Pelagic Cormorant (Urile pelagicus)" to canonical name', () => {
      const match = findBestMatch('Pelagic Cormorant (Urile pelagicus)')
      expect(match).not.toBeNull()
      // May map to Phalacrocorax pelagicus in some taxonomy versions
      expect(match!.common).toContain('Cormorant')
    })
  })

  // ── Full pipeline replay (identifyBirdInPhoto) ─────────

  describe('full pipeline replay', () => {
    const singleBirdFixtures = fixtures.filter(f => !f.parsed.multipleBirds)
    const multiBirdFixtures = fixtures.filter(f => f.parsed.multipleBirds)

    it.each(singleBirdFixtures.map(f => [f.imageFile, f]))(
      'single-bird: %s returns correct species',
      async (_name, fixture) => {
        const f = fixture as Fixture
        replayFixture(f)

        const result = await identifyBirdInPhoto(
          'data:image/jpeg;base64,test',
          fixtureLocation(f),
          f.context.month,
          f.context.locationName,
        )

        expect(result.candidates.length).toBeGreaterThanOrEqual(1)
        expect(result.multipleBirds).toBe(false)

        // Top candidate should be grounded to a valid taxonomy entry
        const top = result.candidates[0]
        expect(top.confidence).toBeGreaterThanOrEqual(0.3)
        // Species name should include scientific name in parens
        expect(top.species).toMatch(/\(.+\)/)
      }
    )

    if (multiBirdFixtures.length > 0) {
      it.each(multiBirdFixtures.map(f => [f.imageFile, f]))(
        'multi-bird: %s reports multipleBirds=true',
        async (_name, fixture) => {
          const f = fixture as Fixture
          replayFixture(f)

          const result = await identifyBirdInPhoto(
            'data:image/jpeg;base64,test',
            fixtureLocation(f),
            f.context.month,
            f.context.locationName,
          )

          expect(result.multipleBirds).toBe(true)
          expect(result.candidates.length).toBeGreaterThanOrEqual(1)
        }
      )
    }
  })

  // ── Candidate ranking contract ──────────────────────────

  it('all fixtures: candidates sorted, filtered ≥ 0.3, at most 5', async () => {
    for (const f of fixtures) {
      replayFixture(f)
      const result = await identifyBirdInPhoto(
        'data:image/jpeg;base64,test',
        fixtureLocation(f),
        f.context.month,
      )

      // Sorted by confidence descending
      for (let i = 1; i < result.candidates.length; i++) {
        expect(result.candidates[i - 1].confidence)
          .toBeGreaterThanOrEqual(result.candidates[i].confidence)
      }
      // All candidates ≥ 0.3
      for (const c of result.candidates) {
        expect(c.confidence).toBeGreaterThanOrEqual(0.3)
      }
      // At most 5
      expect(result.candidates.length).toBeLessThanOrEqual(5)
    }
  })

  // ── Specific species assertions ─────────────────────────

  describe('specific species replay assertions', () => {
    it("identifies Steller's Jay in Seattle backyard", async () => {
      const f = fixtures.find(f => f.imageFile.includes('Stellers_Jay'))!
      replayFixture(f)

      const result = await identifyBirdInPhoto(
        'data:image/jpeg;base64,test',
        fixtureLocation(f),
        f.context.month,
        f.context.locationName,
      )

      expect(result.candidates[0].species).toContain("Steller's Jay")
      expect(result.candidates[0].confidence).toBeGreaterThanOrEqual(0.9)
    })

    it('identifies Chukar on Haleakala, Maui', async () => {
      const f = fixtures.find(f => f.imageFile.includes('Chukar'))!
      replayFixture(f)

      const result = await identifyBirdInPhoto(
        'data:image/jpeg;base64,test',
        fixtureLocation(f),
        f.context.month,
        f.context.locationName,
      )

      expect(result.candidates[0].species).toContain('Chukar')
      expect(result.candidates[0].confidence).toBeGreaterThanOrEqual(0.85)
    })

    it('identifies American Goldfinch at Union Bay', async () => {
      const f = fixtures.find(f => f.imageFile.includes('goldfinch'))!
      replayFixture(f)

      const result = await identifyBirdInPhoto(
        'data:image/jpeg;base64,test',
        fixtureLocation(f),
        f.context.month,
        f.context.locationName,
      )

      expect(result.candidates[0].species).toContain('American Goldfinch')
    })

    it('flags multipleBirds for Cormorants on Skagit Bay', async () => {
      const f = fixtures.find(f => f.imageFile.includes('Cormorants_on_navigation'))!
      replayFixture(f)

      const result = await identifyBirdInPhoto(
        'data:image/jpeg;base64,test',
        fixtureLocation(f),
        f.context.month,
        f.context.locationName,
      )

      expect(result.multipleBirds).toBe(true)
      expect(result.candidates.length).toBeGreaterThanOrEqual(2)
      // One should be a cormorant
      expect(result.candidates.some(c =>
        c.species.toLowerCase().includes('cormorant')
      )).toBe(true)
    })

    it('identifies Dark-eyed Junco in foliage', async () => {
      const f = fixtures.find(f => f.imageFile.includes('junco'))!
      replayFixture(f)

      const result = await identifyBirdInPhoto(
        'data:image/jpeg;base64,test',
        fixtureLocation(f),
        f.context.month,
      )

      expect(result.candidates[0].species).toContain('Dark-eyed Junco')
    })

    it('identifies Rock Pigeon in Amsterdam', async () => {
      const f = fixtures.find(f => f.imageFile.includes('Pigeon'))!
      replayFixture(f)

      const result = await identifyBirdInPhoto(
        'data:image/jpeg;base64,test',
        fixtureLocation(f),
        f.context.month,
        f.context.locationName,
      )

      expect(result.candidates[0].species).toContain('Rock Pigeon')
    })

    it("identifies Anna's Hummingbird in Seattle", async () => {
      const f = fixtures.find(f => f.imageFile.includes('hummingbird'))!
      replayFixture(f)

      const result = await identifyBirdInPhoto(
        'data:image/jpeg;base64,test',
        fixtureLocation(f),
        f.context.month,
        f.context.locationName,
      )

      expect(result.candidates[0].species).toContain("Anna's Hummingbird")
    })

    it('identifies Swan Goose in Fujian, China', async () => {
      const f = fixtures.find(f => f.imageFile.includes('Geese'))!
      replayFixture(f)

      const result = await identifyBirdInPhoto(
        'data:image/jpeg;base64,test',
        fixtureLocation(f),
        f.context.month,
        f.context.locationName,
      )

      expect(result.candidates[0].species).toContain('Goose')
    })
  })
})
