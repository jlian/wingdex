import { describe, it, expect } from 'vitest'
import { clusterPhotosIntoOutings, findMatchingOuting } from '../lib/clustering'
import type { Photo, Outing } from '../lib/types'

// ─── Helpers ──────────────────────────────────────────────

let nextId = 1

function makePhoto(overrides: Partial<Photo> = {}): Photo {
  return {
    id: `photo-${nextId++}`,
    outingId: '',
    dataUrl: '',
    thumbnail: '',
    fileHash: '',
    fileName: 'test.jpg',
    ...overrides,
  }
}

function makeOuting(overrides: Partial<Outing> = {}): Outing {
  return {
    id: `outing-${nextId++}`,
    userId: 'user-1',
    startTime: new Date('2025-06-01T08:00:00Z').toISOString(),
    endTime: new Date('2025-06-01T11:00:00Z').toISOString(),
    locationName: 'Test Park',
    notes: '',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function hoursAfter(base: string, hours: number): string {
  return new Date(new Date(base).getTime() + hours * 60 * 60 * 1000).toISOString()
}

// Roughly: 1 degree latitude ~ 111 km
function gpsOffsetKm(baseLat: number, baseLon: number, kmNorth: number): { lat: number; lon: number } {
  return { lat: baseLat + kmNorth / 111, lon: baseLon }
}

// ─── clusterPhotosIntoOutings ─────────────────────────────

describe('clusterPhotosIntoOutings', () => {
  it('returns empty array for no photos', () => {
    expect(clusterPhotosIntoOutings([])).toEqual([])
  })

  it('puts a single photo in one cluster', () => {
    const photos = [makePhoto({ exifTime: '2025-06-01T08:00:00Z' })]
    const clusters = clusterPhotosIntoOutings(photos)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].photos).toHaveLength(1)
  })

  it('clusters photos within time threshold into one outing', () => {
    const base = '2025-06-01T08:00:00Z'
    const photos = [
      makePhoto({ exifTime: base }),
      makePhoto({ exifTime: hoursAfter(base, 1) }),
      makePhoto({ exifTime: hoursAfter(base, 2) }),
      makePhoto({ exifTime: hoursAfter(base, 4) }),
    ]
    const clusters = clusterPhotosIntoOutings(photos)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].photos).toHaveLength(4)
  })

  it('splits photos that exceed the 5-hour time threshold', () => {
    const base = '2025-06-01T08:00:00Z'
    const photos = [
      makePhoto({ exifTime: base }),
      makePhoto({ exifTime: hoursAfter(base, 2) }),
      // 6 hours after the previous photo - exceeds threshold
      makePhoto({ exifTime: hoursAfter(base, 8) }),
    ]
    const clusters = clusterPhotosIntoOutings(photos)
    expect(clusters).toHaveLength(2)
    expect(clusters[0].photos).toHaveLength(2)
    expect(clusters[1].photos).toHaveLength(1)
  })

  it('splits photos at exactly the time boundary', () => {
    const base = '2025-06-01T08:00:00Z'
    const photos = [
      makePhoto({ exifTime: base }),
      // Exactly 5h01m later - just over threshold
      makePhoto({ exifTime: new Date(new Date(base).getTime() + 5 * 60 * 60 * 1000 + 60_000).toISOString() }),
    ]
    const clusters = clusterPhotosIntoOutings(photos)
    expect(clusters).toHaveLength(2)
  })

  it('clusters photos within distance threshold', () => {
    const base = '2025-06-01T08:00:00Z'
    const gps1 = { lat: 48.0, lon: -122.0 }
    const gps2 = gpsOffsetKm(48.0, -122.0, 3) // 3 km apart
    const photos = [
      makePhoto({ exifTime: base, gps: gps1 }),
      makePhoto({ exifTime: hoursAfter(base, 1), gps: gps2 }),
    ]
    const clusters = clusterPhotosIntoOutings(photos)
    expect(clusters).toHaveLength(1)
  })

  it('splits photos that exceed the 6km distance threshold', () => {
    const base = '2025-06-01T08:00:00Z'
    const gps1 = { lat: 48.0, lon: -122.0 }
    const gps2 = gpsOffsetKm(48.0, -122.0, 8) // 8 km apart
    const photos = [
      makePhoto({ exifTime: base, gps: gps1 }),
      makePhoto({ exifTime: hoursAfter(base, 1), gps: gps2 }),
    ]
    const clusters = clusterPhotosIntoOutings(photos)
    expect(clusters).toHaveLength(2)
  })

  it('groups photos without EXIF time into a single cluster', () => {
    const photos = [
      makePhoto(),
      makePhoto(),
      makePhoto(),
    ]
    const clusters = clusterPhotosIntoOutings(photos)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].photos).toHaveLength(3)
  })

  it('splits photos without GPS by time only', () => {
    const base = '2025-06-01T08:00:00Z'
    const photos = [
      makePhoto({ exifTime: base }),
      makePhoto({ exifTime: hoursAfter(base, 7) }), // over 5 hr gap
    ]
    const clusters = clusterPhotosIntoOutings(photos)
    expect(clusters).toHaveLength(2)
  })

  it('computes center lat/lon from GPS-bearing photos', () => {
    const base = '2025-06-01T08:00:00Z'
    const photos = [
      makePhoto({ exifTime: base, gps: { lat: 48.0, lon: -122.0 } }),
      makePhoto({ exifTime: hoursAfter(base, 1), gps: { lat: 48.04, lon: -122.04 } }), // ~4.4 km apart
    ]
    const clusters = clusterPhotosIntoOutings(photos)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].centerLat).toBeCloseTo(48.02, 2)
    expect(clusters[0].centerLon).toBeCloseTo(-122.02, 2)
  })

  it('sets start/end times from EXIF', () => {
    const base = '2025-06-01T08:00:00Z'
    const photos = [
      makePhoto({ exifTime: hoursAfter(base, 3) }),
      makePhoto({ exifTime: base }),
      makePhoto({ exifTime: hoursAfter(base, 1) }),
    ]
    const clusters = clusterPhotosIntoOutings(photos)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].startTime.getTime()).toBe(new Date(base).getTime())
    expect(clusters[0].endTime.getTime()).toBe(new Date(hoursAfter(base, 3)).getTime())
  })

  it('handles a mix of photos with and without GPS', () => {
    const base = '2025-06-01T08:00:00Z'
    const photos = [
      makePhoto({ exifTime: base, gps: { lat: 48.0, lon: -122.0 } }),
      makePhoto({ exifTime: hoursAfter(base, 1) }), // no GPS - clusters by time only
    ]
    const clusters = clusterPhotosIntoOutings(photos)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].photos).toHaveLength(2)
    // center computed from the one GPS photo
    expect(clusters[0].centerLat).toBeCloseTo(48.0, 1)
  })

  it('creates multiple clusters from interleaved times and locations', () => {
    const base = '2025-06-01T06:00:00Z'
    const photos = [
      // Cluster 1: morning, location A
      makePhoto({ exifTime: base, gps: { lat: 48.0, lon: -122.0 } }),
      makePhoto({ exifTime: hoursAfter(base, 1), gps: { lat: 48.01, lon: -122.01 } }),
      // Cluster 2: evening (>5hr gap), location B (far)
      makePhoto({ exifTime: hoursAfter(base, 8), gps: { lat: 49.0, lon: -123.0 } }),
      makePhoto({ exifTime: hoursAfter(base, 9), gps: { lat: 49.01, lon: -123.01 } }),
    ]
    const clusters = clusterPhotosIntoOutings(photos)
    expect(clusters).toHaveLength(2)
    expect(clusters[0].photos).toHaveLength(2)
    expect(clusters[1].photos).toHaveLength(2)
  })
})

// ─── findMatchingOuting ───────────────────────────────────

describe('findMatchingOuting', () => {
  it('returns undefined when no outings exist', () => {
    const cluster = {
      photos: [makePhoto()],
      startTime: new Date('2025-06-01T09:00:00Z'),
      endTime: new Date('2025-06-01T10:00:00Z'),
    }
    expect(findMatchingOuting(cluster, [])).toBeUndefined()
  })

  it('matches a cluster that overlaps an outing in time', () => {
    const outing = makeOuting({
      startTime: '2025-06-01T08:00:00Z',
      endTime: '2025-06-01T11:00:00Z',
    })
    const cluster = {
      photos: [makePhoto()],
      startTime: new Date('2025-06-01T10:00:00Z'),
      endTime: new Date('2025-06-01T12:00:00Z'),
    }
    expect(findMatchingOuting(cluster, [outing])).toBe(outing)
  })

  it('matches a cluster within the +-5hr buffer', () => {
    const outing = makeOuting({
      startTime: '2025-06-01T08:00:00Z',
      endTime: '2025-06-01T10:00:00Z',
    })
    // Cluster starts 4 hours after outing ends (within 5hr buffer)
    const cluster = {
      photos: [makePhoto()],
      startTime: new Date('2025-06-01T14:00:00Z'),
      endTime: new Date('2025-06-01T15:00:00Z'),
    }
    expect(findMatchingOuting(cluster, [outing])).toBe(outing)
  })

  it('does not match a cluster outside the time buffer', () => {
    const outing = makeOuting({
      startTime: '2025-06-01T08:00:00Z',
      endTime: '2025-06-01T10:00:00Z',
    })
    // Cluster starts 6 hours after outing ends (outside 5hr buffer)
    const cluster = {
      photos: [makePhoto()],
      startTime: new Date('2025-06-01T16:00:00Z'),
      endTime: new Date('2025-06-01T17:00:00Z'),
    }
    expect(findMatchingOuting(cluster, [outing])).toBeUndefined()
  })

  it('matches when both have GPS within 6km', () => {
    const outing = makeOuting({
      startTime: '2025-06-01T08:00:00Z',
      endTime: '2025-06-01T10:00:00Z',
      lat: 48.0,
      lon: -122.0,
    })
    const cluster = {
      photos: [makePhoto()],
      startTime: new Date('2025-06-01T09:00:00Z'),
      endTime: new Date('2025-06-01T10:00:00Z'),
      centerLat: 48.0 + 4 / 111, // ~4 km north
      centerLon: -122.0,
    }
    expect(findMatchingOuting(cluster, [outing])).toBe(outing)
  })

  it('does not match when GPS distance exceeds 6km', () => {
    const outing = makeOuting({
      startTime: '2025-06-01T08:00:00Z',
      endTime: '2025-06-01T10:00:00Z',
      lat: 48.0,
      lon: -122.0,
    })
    const cluster = {
      photos: [makePhoto()],
      startTime: new Date('2025-06-01T09:00:00Z'),
      endTime: new Date('2025-06-01T10:00:00Z'),
      centerLat: 48.0 + 8 / 111, // ~8 km north
      centerLon: -122.0,
    }
    expect(findMatchingOuting(cluster, [outing])).toBeUndefined()
  })

  it('matches when cluster has no GPS (time-only match)', () => {
    const outing = makeOuting({
      startTime: '2025-06-01T08:00:00Z',
      endTime: '2025-06-01T10:00:00Z',
      lat: 48.0,
      lon: -122.0,
    })
    const cluster = {
      photos: [makePhoto()],
      startTime: new Date('2025-06-01T09:00:00Z'),
      endTime: new Date('2025-06-01T09:30:00Z'),
      // no centerLat/centerLon
    }
    expect(findMatchingOuting(cluster, [outing])).toBe(outing)
  })

  it('returns the first matching outing when multiple match', () => {
    const outing1 = makeOuting({
      startTime: '2025-06-01T08:00:00Z',
      endTime: '2025-06-01T10:00:00Z',
    })
    const outing2 = makeOuting({
      startTime: '2025-06-01T09:00:00Z',
      endTime: '2025-06-01T11:00:00Z',
    })
    const cluster = {
      photos: [makePhoto()],
      startTime: new Date('2025-06-01T09:30:00Z'),
      endTime: new Date('2025-06-01T10:30:00Z'),
    }
    expect(findMatchingOuting(cluster, [outing1, outing2])).toBe(outing1)
  })
})
