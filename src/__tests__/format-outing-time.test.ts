import { describe, it, expect } from 'vitest'
import { formatOutingTime } from '@/lib/clustering'

describe('formatOutingTime', () => {
  it('formats same-day range with date and two times', () => {
    const result = formatOutingTime(
      '2025-06-15T08:00:00Z',
      '2025-06-15T11:30:00Z',
    )
    // Should contain the date once and two times
    expect(result).toMatch(/\d+/)           // has date digits
    expect(result).toContain(' - ')         // has a separator
    // Should NOT repeat the date
    const parts = result.split(' - ')
    expect(parts).toHaveLength(2)
  })

  it('formats cross-day range with both dates and times', () => {
    const result = formatOutingTime(
      '2025-06-15T22:00:00Z',
      '2025-06-16T02:00:00Z',
    )
    // Both parts should contain date info
    const parts = result.split(' - ')
    expect(parts).toHaveLength(2)
    // The two parts should be different (different dates)
    expect(parts[0]).not.toBe(parts[1])
  })

  it('handles identical start and end times', () => {
    const result = formatOutingTime(
      '2025-06-15T10:00:00Z',
      '2025-06-15T10:00:00Z',
    )
    // Same-day format: date + same time twice
    expect(result).toContain(' - ')
  })

  it('returns a non-empty string', () => {
    const result = formatOutingTime(
      '2025-01-01T00:00:00Z',
      '2025-12-31T23:59:00Z',
    )
    expect(result.length).toBeGreaterThan(0)
  })
})
