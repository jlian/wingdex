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
    // Cluster is 2 hours after outing ends (within 5hr buffer for time,
    // but >30 min apart so normal 6km distance threshold applies)
    const cluster = {
      photos: [makePhoto()],
      startTime: new Date('2025-06-01T12:00:00Z'),
      endTime: new Date('2025-06-01T13:00:00Z'),
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

// ─── Timezone-aware clustering edge cases ─────────────────

describe('clusterPhotosIntoOutings (offset-aware exifTime)', () => {
  it('clusters photos with same UTC instant from different timezone offsets', () => {
    // Both represent the exact same UTC instant: 2025-06-01T18:00:00Z
    // Hawaii: 8:00 AM local (-10:00)
    // Seattle: 11:00 AM local (-07:00)
    const photos = [
      makePhoto({
        exifTime: '2025-06-01T08:00:00-10:00',  // = 18:00 UTC
        gps: { lat: 20.68, lon: -156.44 },
      }),
      makePhoto({
        exifTime: '2025-06-01T11:00:00-07:00',  // = 18:00 UTC
        gps: { lat: 47.6, lon: -122.4 },
      }),
    ]
    const clusters = clusterPhotosIntoOutings(photos)
    // Same UTC instant → within 5hr threshold, but >6km apart → split by distance
    expect(clusters).toHaveLength(2)
  })

  it('clusters nearby photos with offset-aware times within threshold', () => {
    // Two photos in Seattle, 2 hours apart local time, same GPS area
    const photos = [
      makePhoto({
        exifTime: '2025-06-01T09:00:00-07:00',
        gps: { lat: 47.6, lon: -122.4 },
      }),
      makePhoto({
        exifTime: '2025-06-01T11:00:00-07:00',
        gps: { lat: 47.61, lon: -122.41 },
      }),
    ]
    const clusters = clusterPhotosIntoOutings(photos)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].photos).toHaveLength(2)
  })

  it('splits photos at same local time but far apart in UTC (different TZs)', () => {
    // "11:00 AM" in Taipei (+08:00) = 03:00 UTC
    // "11:00 AM" in Hawaii (-10:00) = 21:00 UTC
    // 18 hours apart in UTC → well beyond 5hr threshold
    const photos = [
      makePhoto({
        exifTime: '2025-06-01T11:00:00+08:00',   // = 03:00 UTC
        gps: { lat: 24.99, lon: 121.59 },
      }),
      makePhoto({
        exifTime: '2025-06-01T11:00:00-10:00',   // = 21:00 UTC
        gps: { lat: 20.68, lon: -156.44 },
      }),
    ]
    const clusters = clusterPhotosIntoOutings(photos)
    // 18h apart in UTC → split
    expect(clusters).toHaveLength(2)
  })

  it('correctly sorts offset-aware photos by UTC for clustering', () => {
    // Photo A: 10 PM Hawaii (-10) = 08:00 UTC next day → 2025-06-02T08:00Z
    // Photo B: 6 AM Taipei (+8) = 22:00 UTC prev day → 2025-06-01T22:00Z
    // Photo B is actually *earlier* in UTC despite later local-calendar feel
    const photos = [
      makePhoto({
        exifTime: '2025-06-02T10:00:00-10:00',  // = June 2 20:00 UTC
        gps: { lat: 20.68, lon: -156.44 },
      }),
      makePhoto({
        exifTime: '2025-06-02T06:00:00+08:00',  // = June 1 22:00 UTC
        gps: { lat: 24.99, lon: 121.59 },
      }),
    ]
    const clusters = clusterPhotosIntoOutings(photos)
    // 22h apart, different locations → 2 clusters
    expect(clusters).toHaveLength(2)
    // The Taipei photo should sort first (earlier UTC)
    expect(clusters[0].photos[0].exifTime).toContain('+08:00')
  })

  it('cluster start/end times are correct UTC instants from offset-aware strings', () => {
    const photos = [
      makePhoto({ exifTime: '2025-06-01T08:00:00-10:00' }),  // = 18:00 UTC
      makePhoto({ exifTime: '2025-06-01T10:00:00-10:00' }),  // = 20:00 UTC
      makePhoto({ exifTime: '2025-06-01T12:00:00-10:00' }),  // = 22:00 UTC
    ]
    const clusters = clusterPhotosIntoOutings(photos)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].startTime.toISOString()).toBe('2025-06-01T18:00:00.000Z')
    expect(clusters[0].endTime.toISOString()).toBe('2025-06-01T22:00:00.000Z')
  })
})

describe('findMatchingOuting (offset-aware strings)', () => {
  it('matches cluster with offset-aware outing times', () => {
    // Outing stored as Hawaii offset-aware ISO
    const outing = makeOuting({
      startTime: '2024-12-18T17:00:00-10:00',  // = Dec 19 03:00 UTC
      endTime: '2024-12-18T19:00:00-10:00',    // = Dec 19 05:00 UTC
      lat: 20.68,
      lon: -156.44,
    })
    // Cluster also at Hawaii times
    const cluster = {
      photos: [makePhoto()],
      startTime: new Date('2024-12-18T18:00:00-10:00'),  // = Dec 19 04:00 UTC
      endTime: new Date('2024-12-18T18:30:00-10:00'),
      centerLat: 20.69,
      centerLon: -156.45,
    }
    expect(findMatchingOuting(cluster, [outing])).toBe(outing)
  })

  it('does not match when offset-aware times are far apart in UTC despite similar local time', () => {
    // Outing in Taipei: 8 AM local (+08:00) = midnight UTC
    const outing = makeOuting({
      startTime: '2025-06-01T08:00:00+08:00',  // = 00:00 UTC
      endTime: '2025-06-01T10:00:00+08:00',    // = 02:00 UTC
      lat: 24.99,
      lon: 121.59,
    })
    // Cluster in Hawaii: 8 AM local (-10:00) = 18:00 UTC
    // 16 hours apart → well outside 5hr buffer
    const cluster = {
      photos: [makePhoto()],
      startTime: new Date('2025-06-01T08:00:00-10:00'),  // = 18:00 UTC
      endTime: new Date('2025-06-01T09:00:00-10:00'),
      centerLat: 20.68,
      centerLon: -156.44,
    }
    expect(findMatchingOuting(cluster, [outing])).toBeUndefined()
  })

  it('matches cluster when offset-aware times are near in UTC despite different local dates', () => {
    // Outing in Hawaii at 11 PM Dec 18 (-10:00) = Dec 19 09:00 UTC
    const outing = makeOuting({
      startTime: '2024-12-18T23:00:00-10:00',  // = Dec 19 09:00 UTC
      endTime: '2024-12-18T23:30:00-10:00',    // = Dec 19 09:30 UTC
    })
    // Cluster 2 hours later in UTC = Dec 19 11:00 UTC (within 5hr buffer)
    const cluster = {
      photos: [makePhoto()],
      startTime: new Date('2024-12-19T11:00:00Z'),
      endTime: new Date('2024-12-19T11:30:00Z'),
    }
    expect(findMatchingOuting(cluster, [outing])).toBe(outing)
  })
})

// ─── Merlin device-location relaxed matching ─────────────

describe('findMatchingOuting (Merlin relaxed distance)', () => {
  it('matches 20km-apart GPS when times are within 30 min (Merlin case)', () => {
    // eBird checklist created by Merlin at the hotel (west Maui)
    const outing = makeOuting({
      startTime: '2024-12-18T17:16:00-10:00',
      endTime: '2024-12-18T18:16:00-10:00',
      lat: 20.6826,   // Lahaina / west Maui (device location)
      lon: -156.4427,
    })
    // Photo EXIF GPS is the actual observation site (central Maui) — 20km away
    // Same time (within 30 min)
    const cluster = {
      photos: [makePhoto()],
      startTime: new Date('2024-12-18T17:16:00-10:00'),
      endTime: new Date('2024-12-18T17:16:00-10:00'),
      centerLat: 20.7148,   // White Hill / central Maui (photo GPS)
      centerLon: -156.2502,
    }
    expect(findMatchingOuting(cluster, [outing])).toBe(outing)
  })

  it('does not match 20km-apart GPS when times are 2 hours apart', () => {
    // Same locations as above, but cluster is 2 hours later — normal 6km threshold applies
    const outing = makeOuting({
      startTime: '2024-12-18T15:00:00-10:00',
      endTime: '2024-12-18T16:00:00-10:00',
      lat: 20.6826,
      lon: -156.4427,
    })
    const cluster = {
      photos: [makePhoto()],
      startTime: new Date('2024-12-18T18:00:00-10:00'),
      endTime: new Date('2024-12-18T18:30:00-10:00'),
      centerLat: 20.7148,
      centerLon: -156.2502,
    }
    expect(findMatchingOuting(cluster, [outing])).toBeUndefined()
  })

  it('does not match 60km-apart GPS even when times are within 30 min', () => {
    // Relaxed threshold is 50km — 60km should still fail
    const outing = makeOuting({
      startTime: '2024-12-18T17:16:00-10:00',
      endTime: '2024-12-18T18:16:00-10:00',
      lat: 20.72,
      lon: -156.15,
    })
    const cluster = {
      photos: [makePhoto()],
      startTime: new Date('2024-12-18T17:20:00-10:00'),
      endTime: new Date('2024-12-18T17:20:00-10:00'),
      // ~60km away (roughly 0.54 degrees latitude)
      centerLat: 20.72 + 60 / 111,
      centerLon: -156.15,
    }
    expect(findMatchingOuting(cluster, [outing])).toBeUndefined()
  })

  it('matches same-island GPS (30km) when times overlap exactly', () => {
    // Exact time overlap with ~30km distance — should match with relaxed threshold
    const outing = makeOuting({
      startTime: '2025-01-15T09:00:00-08:00',
      endTime: '2025-01-15T11:00:00-08:00',
      lat: 47.66,    // Discovery Park, Seattle
      lon: -122.42,
    })
    const cluster = {
      photos: [makePhoto()],
      startTime: new Date('2025-01-15T10:00:00-08:00'),
      endTime: new Date('2025-01-15T10:30:00-08:00'),
      centerLat: 47.90,   // ~27km north (Lynnwood area)
      centerLon: -122.30,
    }
    expect(findMatchingOuting(cluster, [outing])).toBe(outing)
  })
})
