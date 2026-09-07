import { describe, expect, it } from 'vitest'
import { exportOutingToEBirdCSV } from './ebird'
import { coordinateTimeZone, localizeOutingTimes, localizeUTCTimestamp } from './outing-time'

describe('outing-local timestamps', () => {
  const guatemala = { lat: 15.23, lon: -90.23 }

  it('displays the reported Guatemala outing in the morning without moving the instant', () => {
    const outing = { id: 'guatemala', startTime: '2026-08-18T13:13:00Z', endTime: '2026-08-18T15:01:00Z', ...guatemala }
    const local = localizeOutingTimes(outing)
    expect(local.startTime).toBe('2026-08-18T07:13:00-06:00')
    expect(local.endTime).toBe('2026-08-18T09:01:00-06:00')
    expect(Date.parse(local.startTime)).toBe(Date.parse(outing.startTime))
    expect(outing.startTime).toBe('2026-08-18T13:13:00Z')
    expect(localizeOutingTimes(local)).toEqual(local)
  })

  it('preserves explicit offsets, naive dates, and timestamps without reliable coordinates', () => {
    for (const time of ['2026-08-18T07:13:00-06:00', '2026-08-18T07:13:00+00:00', '2026-08-18T07:13:00', '2026-02-30T07:13:00Z', 'invalid']) {
      expect(localizeUTCTimestamp(time, guatemala.lat, guatemala.lon)).toBe(time)
    }
    const invalidCoordinates: [number | null | undefined, number | null | undefined][] = [
      [undefined, undefined], [null, null], [91, 0], [0, 181], [NaN, 0],
    ]
    for (const [latitude, longitude] of invalidCoordinates) {
      expect(localizeUTCTimestamp('2026-08-18T13:13:00Z', latitude, longitude)).toBe('2026-08-18T13:13:00Z')
    }
  })

  it('preserves fractional seconds and handles day and month boundaries', () => {
    const result = localizeUTCTimestamp('2026-09-01T02:13:00.123Z', guatemala.lat, guatemala.lon)
    expect(result).toBe('2026-08-31T20:13:00.123-06:00')
    expect(Date.parse(result)).toBe(Date.parse('2026-09-01T02:13:00.123Z'))
  })

  it('uses the geographic daylight-saving offset at each instant', () => {
    const local = localizeOutingTimes({
      startTime: '2026-03-08T09:30:00Z', endTime: '2026-03-08T10:30:00Z', lat: 47.61, lon: -122.33,
    })
    expect(local.startTime).toBe('2026-03-08T01:30:00-08:00')
    expect(local.endTime).toBe('2026-03-08T03:30:00-07:00')
    expect(Date.parse(local.endTime) - Date.parse(local.startTime)).toBe(3_600_000)
  })

  it('provides a timezone even without a named place', () => {
    expect(coordinateTimeZone(guatemala.lat, guatemala.lon)).toBe('America/Guatemala')
    expect(coordinateTimeZone(null, null)).toBeUndefined()
  })

  it('exports legacy UTC outings using the same local time as details', () => {
    const csv = exportOutingToEBirdCSV({
      id: 'guatemala', locationName: 'Ranchitos del Quetzal', ...guatemala,
      startTime: '2026-08-18T13:13:00Z', endTime: '2026-08-18T15:01:00Z',
    }, [{ speciesName: 'Blue Jay', count: 1, certainty: 'confirmed' }])
    expect(csv).toContain('08/18/2026')
    expect(csv).toContain('07:13')
    expect(csv).not.toContain('13:13')
  })
})
