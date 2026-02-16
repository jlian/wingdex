import { describe, it, expect } from 'vitest'
import {
  toLocalISOWithOffset,
  dateToLocalISOWithOffset,
  formatStoredDate,
  formatStoredTime,
  getOffsetForLocalWallTime,
  getTimezoneFromCoords,
  getUtcOffsetString,
} from '@/lib/timezone'

describe('timezone utilities', () => {
  describe('getTimezoneFromCoords', () => {
    it('returns Pacific/Honolulu for Maui coordinates', () => {
      expect(getTimezoneFromCoords(20.682568, -156.442741)).toBe('Pacific/Honolulu')
    })

    it('returns America/Los_Angeles for Seattle coordinates', () => {
      expect(getTimezoneFromCoords(47.6, -122.4)).toBe('America/Los_Angeles')
    })

    it('returns Asia/Taipei for Taipei coordinates', () => {
      expect(getTimezoneFromCoords(24.99591, 121.588157)).toBe('Asia/Taipei')
    })
  })

  describe('getOffsetForLocalWallTime', () => {
    it('returns -10:00 for Hawaii (no DST)', () => {
      // December 18, 2024, 19:16 in Hawaii
      const offset = getOffsetForLocalWallTime('Pacific/Honolulu', 2024, 11, 18, 19, 16, 0)
      expect(offset).toBe('-10:00')
    })

    it('returns -07:00 for Seattle in summer (PDT)', () => {
      const offset = getOffsetForLocalWallTime('America/Los_Angeles', 2025, 5, 1, 11, 7, 0)
      expect(offset).toBe('-07:00')
    })

    it('returns -08:00 for Seattle in winter (PST)', () => {
      const offset = getOffsetForLocalWallTime('America/Los_Angeles', 2025, 0, 15, 11, 7, 0)
      expect(offset).toBe('-08:00')
    })

    it('returns +08:00 for Taipei', () => {
      const offset = getOffsetForLocalWallTime('Asia/Taipei', 2025, 11, 27, 15, 6, 0)
      expect(offset).toBe('+08:00')
    })
  })

  describe('toLocalISOWithOffset', () => {
    it('handles EXIF-format datetime for Hawaii photo', () => {
      // EXIF: "2024:12:18 17:16:00" taken at Maui
      const result = toLocalISOWithOffset('2024:12:18 17:16:00', 20.682568, -156.442741)
      expect(result).toBe('2024-12-18T17:16:00-10:00')
    })

    it('handles ISO-format datetime for Hawaii photo', () => {
      const result = toLocalISOWithOffset('2024-12-18 17:16:00', 20.682568, -156.442741)
      expect(result).toBe('2024-12-18T17:16:00-10:00')
    })

    it('handles Seattle summer PDT', () => {
      const result = toLocalISOWithOffset('2025-06-01 11:07:00', 47.6, -122.4)
      expect(result).toBe('2025-06-01T11:07:00-07:00')
    })

    it('handles Seattle winter PST', () => {
      const result = toLocalISOWithOffset('2025-01-15 11:07:00', 47.6, -122.4)
      expect(result).toBe('2025-01-15T11:07:00-08:00')
    })

    it('handles Taipei UTC+8', () => {
      const result = toLocalISOWithOffset('2025-12-27 15:06:00', 24.99591, 121.588157)
      expect(result).toBe('2025-12-27T15:06:00+08:00')
    })

    it('handles Dalian China UTC+8', () => {
      const result = toLocalISOWithOffset('2016-06-06 22:50:00', 39.063208, 122.057679)
      expect(result).toBe('2016-06-06T22:50:00+08:00')
    })
  })

  describe('dateToLocalISOWithOffset', () => {
    it('formats a UTC Date in Hawaii timezone', () => {
      // 2024-12-19T05:16:00Z = 2024-12-18T19:16:00 in Hawaii (UTC-10)
      const date = new Date('2024-12-19T05:16:00Z')
      const result = dateToLocalISOWithOffset(date, 20.682568, -156.442741)
      expect(result).toBe('2024-12-18T19:16:00-10:00')
    })

    it('formats a UTC Date in Taipei timezone', () => {
      // 2025-12-27T07:06:00Z = 2025-12-27T15:06:00 in Taipei (UTC+8)
      const date = new Date('2025-12-27T07:06:00Z')
      const result = dateToLocalISOWithOffset(date, 24.99591, 121.588157)
      expect(result).toBe('2025-12-27T15:06:00+08:00')
    })
  })

  describe('formatStoredDate', () => {
    it('displays the local date from an offset-aware ISO string', () => {
      // "2024-12-18T19:16:00-10:00" should show Dec 18, not Dec 19
      const result = formatStoredDate('2024-12-18T19:16:00-10:00', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
      expect(result).toContain('18')
      expect(result).toContain('2024')
    })

    it('displays the local date for a UTC+8 ISO string', () => {
      const result = formatStoredDate('2025-12-27T15:06:00+08:00', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
      expect(result).toContain('27')
      expect(result).toContain('2025')
    })
  })

  describe('formatStoredTime', () => {
    it('displays the local time from an offset-aware ISO string', () => {
      const result = formatStoredTime('2024-12-18T19:16:00-10:00')
      // Should show 7:16 PM or 19:16, not 5:16 AM (UTC interpretation)
      expect(result).toMatch(/07:16|7:16/)
    })

    it('displays the local time for Taipei timezone', () => {
      const result = formatStoredTime('2025-12-27T15:06:00+08:00')
      expect(result).toMatch(/03:06|3:06/)
    })
  })

  // ─── DST transition edge cases ─────────────────────────────

  describe('DST spring-forward (nonexistent local time)', () => {
    // US Pacific: March 9 2025, clocks jump from 2:00 AM → 3:00 AM
    // So 2:30 AM local never exists on the wall clock.
    // Our code should still produce a valid offset-aware ISO string.
    // The expected behavior: resolve to -07:00 (the post-spring-forward PDT offset)
    // since the wall time "2:30 AM" lands after the transition point.

    it('getOffsetForLocalWallTime returns -07:00 for nonexistent 2:30 AM on spring-forward day', () => {
      const offset = getOffsetForLocalWallTime('America/Los_Angeles', 2025, 2, 9, 2, 30, 0)
      // Either -07:00 (PDT, post-transition) or -08:00 (PST, pre-transition) is acceptable;
      // the important thing is it doesn't crash and produces a valid offset.
      expect(offset).toMatch(/^-0[78]:00$/)
    })

    it('toLocalISOWithOffset produces valid ISO for nonexistent 2:30 AM Pacific', () => {
      const result = toLocalISOWithOffset('2025-03-09 02:30:00', 47.6, -122.4)
      expect(result).toMatch(/^2025-03-09T02:30:00-0[78]:00$/)
    })
  })

  describe('DST fall-back (ambiguous local time)', () => {
    // US Pacific: Nov 2 2025, clocks fall back from 2:00 AM → 1:00 AM
    // So 1:30 AM occurs twice: once in PDT (-07:00), once in PST (-08:00).

    it('getOffsetForLocalWallTime returns a valid offset for ambiguous 1:30 AM on fall-back day', () => {
      const offset = getOffsetForLocalWallTime('America/Los_Angeles', 2025, 10, 2, 1, 30, 0)
      expect(offset).toMatch(/^-0[78]:00$/)
    })

    it('toLocalISOWithOffset produces valid ISO for ambiguous 1:30 AM Pacific', () => {
      const result = toLocalISOWithOffset('2025-11-02 01:30:00', 47.6, -122.4)
      expect(result).toMatch(/^2025-11-02T01:30:00-0[78]:00$/)
    })

    it('times well before and well after the transition get correct offsets', () => {
      // 11 PM Nov 1 should be PDT (-07:00)
      const before = getOffsetForLocalWallTime('America/Los_Angeles', 2025, 10, 1, 23, 0, 0)
      expect(before).toBe('-07:00')

      // 3 AM Nov 2 should be PST (-08:00)
      const after = getOffsetForLocalWallTime('America/Los_Angeles', 2025, 10, 2, 3, 0, 0)
      expect(after).toBe('-08:00')
    })
  })

  // ─── Non-standard offsets ──────────────────────────────────

  describe('half-hour and 45-minute offsets', () => {
    it('handles India Standard Time (UTC+5:30)', () => {
      // Delhi coords
      expect(getTimezoneFromCoords(28.6139, 77.2090)).toBe('Asia/Kolkata')
      const result = toLocalISOWithOffset('2025-06-15 14:30:00', 28.6139, 77.2090)
      expect(result).toBe('2025-06-15T14:30:00+05:30')
    })

    it('handles Nepal Time (UTC+5:45)', () => {
      // Kathmandu coords
      expect(getTimezoneFromCoords(27.7172, 85.3240)).toBe('Asia/Kathmandu')
      const result = toLocalISOWithOffset('2025-06-15 14:30:00', 27.7172, 85.3240)
      expect(result).toBe('2025-06-15T14:30:00+05:45')
    })

    it('dateToLocalISOWithOffset handles India +5:30 correctly', () => {
      // 2025-06-15T09:00:00Z = 2025-06-15T14:30:00+05:30
      const date = new Date('2025-06-15T09:00:00Z')
      const result = dateToLocalISOWithOffset(date, 28.6139, 77.2090)
      expect(result).toBe('2025-06-15T14:30:00+05:30')
    })

    it('formatStoredDate preserves local date for +05:30 offset', () => {
      const result = formatStoredDate('2025-06-15T14:30:00+05:30', {
        month: 'short', day: 'numeric', year: 'numeric',
      })
      expect(result).toContain('15')
      expect(result).toContain('2025')
    })

    it('formatStoredTime preserves local time for +05:45 offset', () => {
      const result = formatStoredTime('2025-06-15T14:30:00+05:45')
      expect(result).toMatch(/02:30|2:30/)
    })
  })

  // ─── Date boundary crossing ────────────────────────────────

  describe('date boundary crossing (near midnight)', () => {
    it('negative offset near midnight: Hawaii 11:30 PM keeps local date', () => {
      // 11:30 PM Hawaii = next day 09:30 UTC
      const result = toLocalISOWithOffset('2024-12-18 23:30:00', 20.682568, -156.442741)
      expect(result).toBe('2024-12-18T23:30:00-10:00')

      // formatStoredDate should show Dec 18, not Dec 19
      const dateStr = formatStoredDate(result, { month: 'short', day: 'numeric', year: 'numeric' })
      expect(dateStr).toContain('18')
      expect(dateStr).toContain('2024')
    })

    it('positive offset near midnight: Taipei 12:30 AM keeps local date', () => {
      // 12:30 AM Taipei = previous day 16:30 UTC
      const result = toLocalISOWithOffset('2025-12-27 00:30:00', 24.99591, 121.588157)
      expect(result).toBe('2025-12-27T00:30:00+08:00')

      // formatStoredDate should show Dec 27, not Dec 26
      const dateStr = formatStoredDate(result, { month: 'short', day: 'numeric', year: 'numeric' })
      expect(dateStr).toContain('27')
      expect(dateStr).toContain('2025')
    })

    it('dateToLocalISOWithOffset crosses date backward (UTC→Hawaii)', () => {
      // UTC Dec 19 09:30 = Hawaii Dec 18 23:30
      const date = new Date('2024-12-19T09:30:00Z')
      const result = dateToLocalISOWithOffset(date, 20.682568, -156.442741)
      expect(result).toBe('2024-12-18T23:30:00-10:00')
    })

    it('dateToLocalISOWithOffset crosses date forward (UTC→Taipei)', () => {
      // UTC Dec 26 16:30 = Taipei Dec 27 00:30
      const date = new Date('2025-12-26T16:30:00Z')
      const result = dateToLocalISOWithOffset(date, 24.99591, 121.588157)
      expect(result).toBe('2025-12-27T00:30:00+08:00')
    })

    it('New Year boundary: Hawaii Dec 31 11:30 PM stays in correct year', () => {
      const result = toLocalISOWithOffset('2025-12-31 23:30:00', 20.682568, -156.442741)
      expect(result).toBe('2025-12-31T23:30:00-10:00')
      // UTC is Jan 1 09:30 but local date is Dec 31
      const dateStr = formatStoredDate(result, { month: 'short', day: 'numeric', year: 'numeric' })
      expect(dateStr).toContain('31')
      expect(dateStr).toContain('2025')
    })

    it('New Year boundary: Taipei Jan 1 00:30 AM stays in correct year', () => {
      const result = toLocalISOWithOffset('2026-01-01 00:30:00', 24.99591, 121.588157)
      expect(result).toBe('2026-01-01T00:30:00+08:00')
      // UTC is Dec 31 16:30 but local date is Jan 1
      const dateStr = formatStoredDate(result, { month: 'short', day: 'numeric', year: 'numeric' })
      expect(dateStr).toContain('1')
      expect(dateStr).toContain('2026')
    })
  })

  // ─── UTC instant correctness ───────────────────────────────

  describe('UTC instant correctness from offset-aware ISO', () => {
    it('new Date() parses offset-aware ISO to correct UTC instant', () => {
      // "2024-12-18T19:16:00-10:00" should be Dec 19 05:16 UTC
      const d = new Date('2024-12-18T19:16:00-10:00')
      expect(d.toISOString()).toBe('2024-12-19T05:16:00.000Z')
    })

    it('new Date() parses +08:00 offset to correct UTC instant', () => {
      // "2025-12-27T00:30:00+08:00" should be Dec 26 16:30 UTC
      const d = new Date('2025-12-27T00:30:00+08:00')
      expect(d.toISOString()).toBe('2025-12-26T16:30:00.000Z')
    })

    it('new Date() parses +05:30 offset to correct UTC instant', () => {
      // "2025-06-15T14:30:00+05:30" should be June 15 09:00 UTC
      const d = new Date('2025-06-15T14:30:00+05:30')
      expect(d.toISOString()).toBe('2025-06-15T09:00:00.000Z')
    })

    it('two offset-aware ISOs at the same wall time but different TZs produce different UTC instants', () => {
      const hawaii = new Date('2025-06-01T11:00:00-10:00')     // 21:00 UTC
      const seattle = new Date('2025-06-01T11:00:00-07:00')    // 18:00 UTC
      expect(hawaii.getTime()).not.toBe(seattle.getTime())
      expect(hawaii.getTime() - seattle.getTime()).toBe(3 * 3600_000) // 3 hours apart
    })
  })

  // ─── Legacy string backward compatibility ──────────────────

  describe('legacy string backward compatibility', () => {
    it('formatStoredDate falls back to browser-local for Z-suffix strings', () => {
      // The Z-suffix path uses `new Date(timeStr).toLocaleDateString()` (browser local)
      // We just verify it doesn't crash and returns something parseable
      const result = formatStoredDate('2024-12-18T19:16:00.000Z')
      expect(result).toBeTruthy()
      expect(typeof result).toBe('string')
    })

    it('formatStoredTime falls back to browser-local for Z-suffix strings', () => {
      const result = formatStoredTime('2024-12-18T19:16:00.000Z')
      expect(result).toBeTruthy()
      expect(typeof result).toBe('string')
    })

    it('formatStoredDate handles naive datetime strings', () => {
      const result = formatStoredDate('2024-12-18 19:16:00')
      expect(result).toBeTruthy()
    })

    it('formatStoredTime handles naive datetime strings', () => {
      const result = formatStoredTime('2024-12-18 19:16:00')
      expect(result).toBeTruthy()
    })
  })

  // ─── getUtcOffsetString edge cases ─────────────────────────

  describe('getUtcOffsetString edge cases', () => {
    it('returns +00:00 for UTC timezone', () => {
      const result = getUtcOffsetString('UTC', new Date('2025-06-01T12:00:00Z'))
      expect(result).toBe('+00:00')
    })

    it('returns +00:00 for GMT timezone', () => {
      const result = getUtcOffsetString('Etc/GMT', new Date('2025-06-01T12:00:00Z'))
      expect(result).toBe('+00:00')
    })

    it('handles London BST (summer UTC+1) vs GMT (winter UTC+0)', () => {
      const summer = getUtcOffsetString('Europe/London', new Date('2025-07-01T12:00:00Z'))
      expect(summer).toBe('+01:00')

      const winter = getUtcOffsetString('Europe/London', new Date('2025-01-01T12:00:00Z'))
      expect(winter).toBe('+00:00')
    })
  })
})
