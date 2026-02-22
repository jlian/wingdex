import { describe, it, expect } from 'vitest'
import { safeParseJSON, extractAssistantContent, buildCropBox } from '../../functions/lib/bird-id-helpers'

describe('bird-id helpers', () => {
  describe('safeParseJSON', () => {
    it('parses valid JSON directly', () => {
      const result = safeParseJSON('{"candidates":[{"species":"Robin","confidence":0.9}]}')
      expect(result.candidates[0].species).toBe('Robin')
    })

    it('extracts JSON from fenced code blocks', () => {
      const input = 'Here is the result:\n```json\n{"candidates":[{"species":"Robin","confidence":0.9}]}\n```\nDone.'
      const result = safeParseJSON(input)
      expect(result.candidates[0].species).toBe('Robin')
    })

    it('extracts bare JSON object from surrounding text', () => {
      const input = 'The bird is: {"candidates":[{"species":"Robin","confidence":0.9}]} hope this helps'
      const result = safeParseJSON(input)
      expect(result.candidates[0].species).toBe('Robin')
    })

    it('returns null for completely unparseable text', () => {
      expect(safeParseJSON('This is just a sentence about birds.')).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(safeParseJSON('')).toBeNull()
    })

    it('handles fenced block without json language tag', () => {
      const input = '```\n{"a":1}\n```'
      expect(safeParseJSON(input)).toEqual({ a: 1 })
    })

    it('handles malformed JSON inside fenced block gracefully', () => {
      const input = '```json\n{not valid json}\n```'
      // Falls through to bare-object extraction, which also fails
      expect(safeParseJSON(input)).toBeNull()
    })
  })

  describe('extractAssistantContent', () => {
    it('extracts string content from standard OpenAI response', () => {
      const payload = {
        choices: [{
          message: { content: '{"candidates":[]}' },
        }],
      }
      expect(extractAssistantContent(payload)).toBe('{"candidates":[]}')
    })

    it('joins array-of-parts content', () => {
      const payload = {
        choices: [{
          message: {
            content: [
              { type: 'text', text: 'Part 1' },
              { type: 'text', text: 'Part 2' },
            ],
          },
        }],
      }
      expect(extractAssistantContent(payload)).toBe('Part 1\nPart 2')
    })

    it('handles output_text part type', () => {
      const payload = {
        choices: [{
          message: {
            content: [
              { type: 'output_text', content: 'output text result' },
            ],
          },
        }],
      }
      expect(extractAssistantContent(payload)).toBe('output text result')
    })

    it('handles nested text.value format', () => {
      const payload = {
        choices: [{
          message: {
            content: [
              { text: { value: 'nested value' } },
            ],
          },
        }],
      }
      expect(extractAssistantContent(payload)).toBe('nested value')
    })

    it('returns refusal message when content is empty', () => {
      const payload = {
        choices: [{
          message: { content: null, refusal: 'I cannot identify this image.' },
        }],
      }
      expect(extractAssistantContent(payload)).toBe('I cannot identify this image.')
    })

    it('stringifies object content as fallback', () => {
      const payload = {
        choices: [{
          message: { content: { candidates: [] } },
        }],
      }
      expect(extractAssistantContent(payload)).toBe('{"candidates":[]}')
    })

    it('returns empty string for null/undefined payload', () => {
      expect(extractAssistantContent(null)).toBe('')
      expect(extractAssistantContent(undefined)).toBe('')
      expect(extractAssistantContent({})).toBe('')
    })

    it('handles string array parts', () => {
      const payload = {
        choices: [{
          message: { content: ['hello', 'world'] },
        }],
      }
      expect(extractAssistantContent(payload)).toBe('hello\nworld')
    })
  })

  describe('buildCropBox', () => {
    it('returns undefined for non-array birdCenter', () => {
      expect(buildCropBox(null, 'small')).toBeUndefined()
      expect(buildCropBox('center', 'small')).toBeUndefined()
      expect(buildCropBox({}, 'small')).toBeUndefined()
    })

    it('returns undefined for array with fewer than 2 elements', () => {
      expect(buildCropBox([50], 'small')).toBeUndefined()
    })

    it('returns undefined for non-finite coordinates', () => {
      expect(buildCropBox([NaN, 50], 'small')).toBeUndefined()
      expect(buildCropBox([50, Infinity], 'small')).toBeUndefined()
    })

    it('builds crop box for small bird without image dimensions', () => {
      const box = buildCropBox([50, 50], 'small')
      expect(box).toBeDefined()
      // small = 0.4 → 40%
      expect(box!.width).toBe(40)
      expect(box!.height).toBe(40)
      // centered: 50 - 20 = 30
      expect(box!.x).toBe(30)
      expect(box!.y).toBe(30)
    })

    it('builds crop box for medium bird without image dimensions', () => {
      const box = buildCropBox([50, 50], 'medium')
      expect(box).toBeDefined()
      expect(box!.width).toBe(55)
      expect(box!.height).toBe(55)
    })

    it('builds crop box for large bird without image dimensions', () => {
      const box = buildCropBox([50, 50], 'large')
      expect(box).toBeDefined()
      expect(box!.width).toBe(75)
      expect(box!.height).toBe(75)
    })

    it('clamps crop box to stay within 0-100 bounds', () => {
      // Bird in top-left corner
      const box = buildCropBox([5, 5], 'medium')
      expect(box).toBeDefined()
      expect(box!.x).toBe(0)
      expect(box!.y).toBe(0)
    })

    it('clamps when bird is near bottom-right edge', () => {
      const box = buildCropBox([95, 95], 'small')
      expect(box).toBeDefined()
      // 95 - 20 = 75, but 100 - 40 = 60, so clamped to 60
      expect(box!.x).toBe(60)
      expect(box!.y).toBe(60)
    })

    it('computes crop box with image dimensions (square image)', () => {
      const box = buildCropBox([50, 50], 'small', 1000, 1000)
      expect(box).toBeDefined()
      // small=0.4, shortSide=1000, cropPx=400
      // wPct = 400/1000*100 = 40, hPct = 400/1000*100 = 40
      expect(box!.width).toBe(40)
      expect(box!.height).toBe(40)
    })

    it('computes crop box with image dimensions (landscape image)', () => {
      const box = buildCropBox([50, 50], 'small', 2000, 1000)
      expect(box).toBeDefined()
      // small=0.4, shortSide=1000, cropPx=400
      // wPct = 400/2000*100 = 20, hPct = 400/1000*100 = 40
      expect(box!.width).toBe(20)
      expect(box!.height).toBe(40)
    })

    it('clamps coordinates exceeding 0-100 range', () => {
      const box = buildCropBox([150, -20], 'small')
      expect(box).toBeDefined()
      // 150 → clamped to 100, -20 → clamped to 0
      // x = min(60, 100-20) = 60, y = max(0, 0-20) = 0
      expect(box!.x).toBe(60)
      expect(box!.y).toBe(0)
    })

    it('defaults to small size for unknown birdSize values', () => {
      const box = buildCropBox([50, 50], 'tiny')
      expect(box).toBeDefined()
      // falls through to 0.4 (small default)
      expect(box!.width).toBe(40)
    })
  })
})
