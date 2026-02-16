/**
 * Replay tests for AI bird identification using real LLM response fixtures.
 *
 * These tests mock the fetch call to return captured responses from GitHub Models
 * (stored in fixtures/llm-responses/) and verify the full pipeline:
 *   1. JSON parsing robustness (safeParseJSON on raw LLM output)
 *   2. Taxonomy grounding (findBestMatch normalization)
 *   3. Crop box derivation from birdCenter + birdSize
 *   4. Candidate ranking and filtering contracts
 *
 * Fixtures are captured via: node scripts/capture-llm-fixtures.mjs
 * No network calls are made during these tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { findBestMatch } from '@/lib/taxonomy'

// ── Fixture loading ─────────────────────────────────────────

interface Fixture {
  imageFile: string
  context: { lat: number; lon: number; month: number; locationName: string }
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

const { identifyBirdInPhoto, safeParseJSON } = await import('@/lib/ai-inference')

function replayFixture(fixture: Fixture) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: fixture.rawResponse } }],
    }),
    text: async () => fixture.rawResponse,
  })
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

  it('has at least 6 fixtures', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(6)
  })

  it.each(fixtures.map(f => [f.imageFile, f]))(
    'fixture %s has required fields',
    (_name, fixture) => {
      const f = fixture as Fixture
      expect(f.rawResponse).toBeTruthy()
      expect(f.parsed).toBeTruthy()
      expect(Array.isArray(f.parsed.candidates)).toBe(true)
      expect(f.model).toBeTruthy()
      expect(f.context.lat).toBeTypeOf('number')
      expect(f.context.lon).toBeTypeOf('number')
    }
  )

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
          { lat: f.context.lat, lon: f.context.lon },
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
            { lat: f.context.lat, lon: f.context.lon },
            f.context.month,
            f.context.locationName,
          )

          expect(result.multipleBirds).toBe(true)
          expect(result.candidates.length).toBeGreaterThanOrEqual(1)
        }
      )
    }
  })

  // ── Crop box derivation ─────────────────────────────────

  describe('crop box derivation from fixtures', () => {
    const fixturesWithCenter = fixtures.filter(
      f => f.parsed.birdCenter && f.parsed.birdSize
    )

    it.each(fixturesWithCenter.map(f => [f.imageFile, f]))(
      '%s produces a valid crop box',
      async (_name, fixture) => {
        const f = fixture as Fixture
        replayFixture(f)

        const result = await identifyBirdInPhoto(
          'data:image/jpeg;base64,test',
          { lat: f.context.lat, lon: f.context.lon },
          f.context.month,
        )

        expect(result.cropBox).toBeDefined()
        const { x, y, width, height } = result.cropBox!
        // All values should be percentages 0-100
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(100)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(100)
        expect(width).toBeGreaterThan(0)
        expect(width).toBeLessThanOrEqual(100)
        expect(height).toBeGreaterThan(0)
        expect(height).toBeLessThanOrEqual(100)
        // Crop should not exceed image bounds
        expect(x + width).toBeLessThanOrEqual(100)
        expect(y + height).toBeLessThanOrEqual(100)
      }
    )

    it('small bird gets ~40% crop size', async () => {
      // Use a fixture with birdSize="small"
      const smallFixture = fixtures.find(f => f.parsed.birdSize === 'small')
      if (!smallFixture) return
      replayFixture(smallFixture)

      const result = await identifyBirdInPhoto('data:image/jpeg;base64,test')
      expect(result.cropBox).toBeDefined()
      // On a 800x600 image (mock), shortSide=600, 40% = 240px
      // wPct = 240/800*100 = 30, hPct = 240/600*100 = 40
      expect(result.cropBox!.height).toBe(40)
      expect(result.cropBox!.width).toBe(30)
    })

    it('medium bird gets ~55% crop size', async () => {
      const medFixture = fixtures.find(f => f.parsed.birdSize === 'medium')
      if (!medFixture) return
      replayFixture(medFixture)

      const result = await identifyBirdInPhoto('data:image/jpeg;base64,test')
      expect(result.cropBox).toBeDefined()
      // 55% of 600 = 330px → wPct=330/800*100≈41, hPct=330/600*100=55
      expect(result.cropBox!.height).toBe(55)
      expect(result.cropBox!.width).toBe(41)
    })
  })

  // ── Candidate ranking contract ──────────────────────────

  describe('candidate ranking and filtering', () => {
    it.each(fixtures.map(f => [f.imageFile, f]))(
      '%s: candidates sorted by confidence descending',
      async (_name, fixture) => {
        const f = fixture as Fixture
        replayFixture(f)

        const result = await identifyBirdInPhoto(
          'data:image/jpeg;base64,test',
          { lat: f.context.lat, lon: f.context.lon },
          f.context.month,
        )

        for (let i = 1; i < result.candidates.length; i++) {
          expect(result.candidates[i - 1].confidence)
            .toBeGreaterThanOrEqual(result.candidates[i].confidence)
        }
      }
    )

    it.each(fixtures.map(f => [f.imageFile, f]))(
      '%s: all candidates have confidence >= 0.3',
      async (_name, fixture) => {
        const f = fixture as Fixture
        replayFixture(f)

        const result = await identifyBirdInPhoto(
          'data:image/jpeg;base64,test',
          { lat: f.context.lat, lon: f.context.lon },
          f.context.month,
        )

        for (const c of result.candidates) {
          expect(c.confidence).toBeGreaterThanOrEqual(0.3)
        }
      }
    )

    it.each(fixtures.map(f => [f.imageFile, f]))(
      '%s: at most 5 candidates',
      async (_name, fixture) => {
        const f = fixture as Fixture
        replayFixture(f)

        const result = await identifyBirdInPhoto(
          'data:image/jpeg;base64,test',
          { lat: f.context.lat, lon: f.context.lon },
          f.context.month,
        )

        expect(result.candidates.length).toBeLessThanOrEqual(5)
      }
    )
  })

  // ── Specific species assertions ─────────────────────────

  describe('specific species replay assertions', () => {
    it("identifies Steller's Jay in Seattle backyard", async () => {
      const f = fixtures.find(f => f.imageFile.includes('Stellers_Jay'))!
      replayFixture(f)

      const result = await identifyBirdInPhoto(
        'data:image/jpeg;base64,test',
        { lat: f.context.lat, lon: f.context.lon },
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
        { lat: f.context.lat, lon: f.context.lon },
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
        { lat: f.context.lat, lon: f.context.lon },
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
        { lat: f.context.lat, lon: f.context.lon },
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
        { lat: f.context.lat, lon: f.context.lon },
        f.context.month,
      )

      expect(result.candidates[0].species).toContain('Dark-eyed Junco')
    })

    it('identifies Rock Pigeon in Amsterdam', async () => {
      const f = fixtures.find(f => f.imageFile.includes('Pigeon'))!
      replayFixture(f)

      const result = await identifyBirdInPhoto(
        'data:image/jpeg;base64,test',
        { lat: f.context.lat, lon: f.context.lon },
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
        { lat: f.context.lat, lon: f.context.lon },
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
        { lat: f.context.lat, lon: f.context.lon },
        f.context.month,
        f.context.locationName,
      )

      expect(result.candidates[0].species).toContain('Goose')
    })
  })
})
