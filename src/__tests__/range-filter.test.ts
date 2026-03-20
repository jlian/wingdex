import { describe, it, expect } from 'vitest'
import { adjustConfidence } from '../../functions/lib/range-filter'

describe('adjustConfidence', () => {
  it('returns original confidence when no data', () => {
    expect(adjustConfidence(0.80, { status: 'no-data' })).toBe(0.80)
  })

  it('no penalty when species is present this season', () => {
    expect(adjustConfidence(0.80, { status: 'present' })).toBe(0.80)
    expect(adjustConfidence(0.92, { status: 'present' })).toBe(0.92)
  })

  it('moderate penalty when wrong season', () => {
    // 0.80 * 0.6 = 0.48
    expect(adjustConfidence(0.80, { status: 'wrong-season' })).toBeCloseTo(0.48)
  })

  it('strong penalty when out of range', () => {
    // 0.80 * 0.35 = 0.28
    expect(adjustConfidence(0.80, { status: 'out-of-range' })).toBeCloseTo(0.28)
  })

  it('penalties scale proportionally with confidence', () => {
    const highConf = adjustConfidence(0.90, { status: 'out-of-range' })
    const lowConf = adjustConfidence(0.45, { status: 'out-of-range' })
    expect(highConf / 0.90).toBeCloseTo(lowConf / 0.45)
  })
})
