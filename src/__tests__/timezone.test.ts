import { describe, it, expect } from 'vitest'
import {
  toLocalISOWithOffset,
  dateToLocalISOWithOffset,
  formatStoredDate,
  formatStoredTime,
  getOffsetForLocalWallTime,
  getTimezoneFromCoords,
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
})
