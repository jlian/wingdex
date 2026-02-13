import { describe, it, expect } from 'vitest'
import {
  parseEBirdCSV,
  exportDexToCSV,
  exportOutingToEBirdCSV,
  groupPreviewsIntoOutings,
  detectImportConflicts,
} from '@/lib/ebird'
import type { DexEntry, Outing, Observation } from '@/lib/types'

describe('eBird CSV utilities', () => {
  it('parses quoted commas and escaped quotes correctly', () => {
    const csv = [
      '"Common Name","Scientific Name","Count","Location","Date"',
      '"Eurasian Wigeon","Mareca penelope","2","Lake ""North"", WA","2024-05-01"',
    ].join('\n')

    const previews = parseEBirdCSV(csv)
    expect(previews).toHaveLength(1)
    expect(previews[0].speciesName).toBe('Eurasian Wigeon (Mareca penelope)')
    expect(previews[0].location).toBe('Lake "North", WA')
    expect(previews[0].count).toBe(2)
    expect(previews[0].date).toContain('2024-05-01')
  })

  it('skips rows with invalid dates instead of coercing to now', () => {
    const csv = [
      '"Common Name","Date","Location"',
      '"Mallard","not-a-date","Wetland"',
      '"Northern Pintail","2024-11-15","Lagoon"',
    ].join('\n')

    const previews = parseEBirdCSV(csv)
    expect(previews).toHaveLength(1)
    expect(previews[0].speciesName).toBe('Northern Pintail')
    expect(previews[0].location).toBe('Lagoon')
  })

  it('escapes quotes in dex CSV export', () => {
    const dex: DexEntry[] = [
      {
        speciesName: 'Test Bird, Example',
        firstSeenDate: '2024-01-01T00:00:00.000Z',
        lastSeenDate: '2024-02-01T00:00:00.000Z',
        totalOutings: 2,
        totalCount: 5,
        notes: 'He said "wow"',
      },
    ]

    const csv = exportDexToCSV(dex)
    expect(csv).toContain('"Test Bird, Example"')
    expect(csv).toContain('"He said ""wow"""')
  })

  it('escapes quotes in outing CSV export', () => {
    const outing: Outing = {
      id: 'outing_1',
      userId: 'u1',
      startTime: '2024-05-01T12:00:00.000Z',
      endTime: '2024-05-01T13:00:00.000Z',
      locationName: 'Lake "North" WA',
      notes: 'Field note "A"',
      createdAt: '2024-05-01T12:00:00.000Z',
    }
    const observations: Observation[] = [
      {
        id: 'obs_1',
        outingId: 'outing_1',
        speciesName: 'Mallard (Anas platyrhynchos)',
        count: 3,
        certainty: 'confirmed',
        notes: 'Seen near "dock"',
      },
    ]

    const csv = exportOutingToEBirdCSV(outing, observations)
    const cells = csv.split(',')

    expect(cells).toHaveLength(19)
    expect(csv).toContain('"Mallard"')
    expect(csv).toContain('"Anas"')
    expect(csv).toContain('"platyrhynchos"')
    expect(csv).toContain('"3"')
    expect(csv).toContain('"Lake North WA"')
    expect(csv).toContain('"Incidental"')
    expect(csv).toContain('"N"')
    expect(csv).toContain('"Seen near dock"')
    expect(csv).toContain('"Field note A"')
  })

  it('can emit optional eBird record header in canonical order', () => {
    const outing: Outing = {
      id: 'outing_1',
      userId: 'u1',
      startTime: '2024-05-01T12:00:00.000Z',
      endTime: '2024-05-01T13:00:00.000Z',
      locationName: 'Lake',
      notes: '',
      createdAt: '2024-05-01T12:00:00.000Z',
    }
    const observations: Observation[] = [
      {
        id: 'obs_1',
        outingId: 'outing_1',
        speciesName: 'Mallard (Anas platyrhynchos)',
        count: 1,
        certainty: 'confirmed',
        notes: '',
      },
    ]

    const csv = exportOutingToEBirdCSV(outing, observations, { includeHeader: true })
    const [header] = csv.split('\n')

    expect(header).toBe(
      'Common Name,Genus,Species,Number,Species Comments,Location Name,Latitude,Longitude,Date,Start Time,State/Province,Country Code,Protocol,Number of Observers,Duration,All observations reported?,Effort Distance Miles,Effort area acres,Submission Comments'
    )
  })

  it('groups previews into outings by same day and location', () => {
    const previews = [
      { speciesName: 'A', date: '2024-05-01T10:00:00.000Z', location: 'Park', count: 1 },
      { speciesName: 'B', date: '2024-05-01T11:00:00.000Z', location: 'Park', count: 2 },
      { speciesName: 'A', date: '2024-05-02T10:00:00.000Z', location: 'Park', count: 1 },
    ]

    const { outings, observations } = groupPreviewsIntoOutings(previews, 'u1')
    expect(outings).toHaveLength(2)
    expect(observations.length).toBeGreaterThanOrEqual(2)
  })

  it('marks in-range dates as duplicate import conflicts', () => {
    const existing = new Map<string, DexEntry>([
      ['Mallard', {
        speciesName: 'Mallard',
        firstSeenDate: '2024-01-01T00:00:00.000Z',
        lastSeenDate: '2024-12-31T00:00:00.000Z',
        totalOutings: 10,
        totalCount: 120,
        notes: '',
      }],
    ])

    const conflicts = detectImportConflicts([
      {
        speciesName: 'Mallard',
        date: '2024-06-15T00:00:00.000Z',
        location: 'Wetland',
        count: 3,
      },
    ], existing)

    expect(conflicts[0].conflict).toBe('duplicate')
  })
})
