import { describe, it, expect } from 'vitest'
import {
  parseEBirdCSV,
  exportDexToCSV,
  exportOutingToEBirdCSV,
  groupPreviewsIntoOutings,
  detectImportConflicts,
  extractSavedSpotsFromPreviews,
} from '@/lib/ebird'
import type { DexEntry, Outing, Observation, SavedSpot } from '@/lib/types'

/* ------------------------------------------------------------------ */
/*  Real eBird "Download My Data" header                               */
/* ------------------------------------------------------------------ */
const EBIRD_HEADER =
  'Submission ID,Common Name,Scientific Name,Taxonomic Order,Count,State/Province,County,Location ID,Location,Latitude,Longitude,Date,Time,Protocol,Duration (Min),All Obs Reported,Distance Traveled (km),Area Covered (ha),Number of Observers,Breeding Code,Observation Details,Checklist Comments,ML Catalog Numbers'

/** Helper: build a real-format eBird CSV from rows */
function ebirdCSV(rows: string[]): string {
  return [EBIRD_HEADER, ...rows].join('\n')
}

/** Simple CSV line parser for test assertions */
function parseCSVLineForTest(line: string): string[] {
  const values: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      values.push(current)
      current = ''
    } else {
      current += char
    }
  }
  values.push(current)
  return values
}

describe('eBird CSV utilities', () => {
  /* ---------- original tests (kept for backwards compat) ---------- */

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
        speciesName: 'Test Bird, Example (Testus exempli)',
        firstSeenDate: '2024-01-01T00:00:00.000Z',
        lastSeenDate: '2024-02-01T00:00:00.000Z',
        totalOutings: 2,
        totalCount: 5,
        notes: 'He said "wow"',
      },
    ]

    const csv = exportDexToCSV(dex)
    expect(csv).toContain('"Test Bird, Example"')
    expect(csv).toContain('"Testus exempli"')
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

  /* ---------- real eBird "Download My Data" format tests ---------- */

  describe('real eBird CSV format', () => {
    it('parses a real eBird row with all standard columns', () => {
      const csv = ebirdCSV([
        'S276393806,Canada Goose,Branta canadensis,342,X,US-IL,Cook,L53451695,Montrose Point,41.963254,-87.631954,2025-09-28,08:15 AM,eBird - Casual Observation,,0,,,1,,,,',
      ])

      const previews = parseEBirdCSV(csv)
      expect(previews).toHaveLength(1)

      const p = previews[0]
      expect(p.speciesName).toBe('Canada Goose (Branta canadensis)')
      expect(p.count).toBe(1) // "X" → 1
      expect(p.location).toBe('Montrose Point')
      expect(p.lat).toBeCloseTo(41.963254)
      expect(p.lon).toBeCloseTo(-87.631954)
      expect(p.submissionId).toBe('S276393806')
      expect(p.stateProvince).toBe('US-IL')
    })

    it('handles "X" count as 1', () => {
      const csv = ebirdCSV([
        'S1,Mallard,Anas platyrhynchos,545,X,US-WA,King,L1,Home,47.6,-122.4,2025-06-01,11:07 AM,eBird - Casual Observation,,0,,,1,,,,',
      ])

      const p = parseEBirdCSV(csv)[0]
      expect(p.count).toBe(1)
    })

    it('handles numeric count correctly', () => {
      const csv = ebirdCSV([
        'S1,Mallard,Anas platyrhynchos,545,5,US-WA,King,L1,Home,47.6,-122.4,2025-06-01,11:07 AM,eBird - Casual Observation,,0,,,1,,,,',
      ])

      const p = parseEBirdCSV(csv)[0]
      expect(p.count).toBe(5)
    })

    it('combines date and AM time into ISO timestamp', () => {
      const csv = ebirdCSV([
        'S1,Mallard,Anas platyrhynchos,545,X,US-WA,,L1,Park,47.6,-122.4,2025-09-28,08:15 AM,eBird - Casual Observation,,0,,,1,,,,',
      ])

      const p = parseEBirdCSV(csv)[0]
      const d = new Date(p.date)
      expect(d.getHours()).toBe(8)
      expect(d.getMinutes()).toBe(15)
    })

    it('combines date and PM time into ISO timestamp', () => {
      const csv = ebirdCSV([
        'S1,Sooty Grouse,Dendragapus fuliginosus,1320,X,US-WA,Pierce,L1,Mt Rainier,46.8,-121.7,2023-07-30,01:09 PM,eBird - Casual Observation,,0,,,1,,,,',
      ])

      const p = parseEBirdCSV(csv)[0]
      const d = new Date(p.date)
      expect(d.getHours()).toBe(13)
      expect(d.getMinutes()).toBe(9)
    })

    it('handles 12:xx PM correctly (noon)', () => {
      const csv = ebirdCSV([
        'S1,Killdeer,Charadrius vociferus,5827,X,US-WA,,L1,Park,47.6,-122.4,2025-10-05,12:08 PM,eBird - Casual Observation,,0,,,1,,,,',
      ])

      const p = parseEBirdCSV(csv)[0]
      const d = new Date(p.date)
      expect(d.getHours()).toBe(12)
      expect(d.getMinutes()).toBe(8)
    })

    it('handles 12:xx AM correctly (midnight)', () => {
      const csv = ebirdCSV([
        'S1,Crow,Corvus brachyrhynchos,21557,X,US-WA,,L1,Park,47.6,-122.4,2025-10-05,12:30 AM,eBird - Casual Observation,,0,,,1,,,,',
      ])

      const p = parseEBirdCSV(csv)[0]
      const d = new Date(p.date)
      expect(d.getHours()).toBe(0)
      expect(d.getMinutes()).toBe(30)
    })

    it('parses rows with empty time field', () => {
      const csv = ebirdCSV([
        'S276391486,Merlin,Falco columbarius,12062,X,US-IL,Cook,L53451695,Montrose Point,41.963254,-87.631954,2025-09-28,,eBird - Casual Observation,,0,,,1,,,,',
      ])

      const previews = parseEBirdCSV(csv)
      expect(previews).toHaveLength(1)
      expect(previews[0].time).toBeUndefined()
    })

    it('captures observation details and checklist comments', () => {
      const csv = [
        EBIRD_HEADER,
        'S1,Mallard,Anas platyrhynchos,545,3,US-WA,King,L1,Lake,47.6,-122.4,2025-06-01,09:00 AM,Traveling,60,1,2,,1,,Flying overhead,Beautiful morning,',
      ].join('\n')

      const p = parseEBirdCSV(csv)[0]
      expect(p.observationNotes).toBe('Flying overhead')
      expect(p.checklistNotes).toBe('Beautiful morning')
    })

    it('parses multiple rows from a real eBird export', () => {
      const csv = ebirdCSV([
        'S276395334,Tufted Puffin,Fratercula cirrhata,6378,X,US-WA,Island,L53452489,Smith Island,48.320427,-122.83517,2025-08-16,05:38 PM,eBird - Casual Observation,,0,,,1,,,,',
        'S276395431,Pigeon Guillemot,Cepphus columba,6404,X,US-WA,Island,L53452489,Smith Island,48.320427,-122.83517,2025-08-16,06:53 PM,eBird - Casual Observation,,0,,,1,,,,',
        'S276395380,Rhinoceros Auklet,Cerorhinca monocerata,6377,X,US-WA,Island,L53452489,Smith Island,48.320427,-122.83517,2025-08-16,05:35 PM,eBird - Casual Observation,,0,,,1,,,,',
      ])

      const previews = parseEBirdCSV(csv)
      expect(previews).toHaveLength(3)
      
      const names = previews.map(p => p.speciesName)
      expect(names).toContain('Tufted Puffin (Fratercula cirrhata)')
      expect(names).toContain('Pigeon Guillemot (Cepphus columba)')
      expect(names).toContain('Rhinoceros Auklet (Cerorhinca monocerata)')

      // All share Smith Island
      for (const p of previews) {
        expect(p.location).toBe('Smith Island')
        expect(p.lat).toBeCloseTo(48.320427)
        expect(p.lon).toBeCloseTo(-122.83517)
      }
    })

    it('handles international locations with empty County', () => {
      const csv = ebirdCSV([
        'S276512830,Rock Pigeon,Columba livia,1853,X,CN-21,,L53473988,Dalian,39.063208,122.057679,2016-06-06,10:50 PM,eBird - Casual Observation,,0,,,1,,,,',
      ])

      const p = parseEBirdCSV(csv)[0]
      expect(p.speciesName).toBe('Rock Pigeon (Columba livia)')
      expect(p.location).toBe('Dalian')
      expect(p.stateProvince).toBe('CN-21')
    })
  })

  describe('grouping with submissionId', () => {
    it('groups by submissionId when available', () => {
      const previews = [
        { speciesName: 'A', date: '2024-05-01T10:00:00.000Z', location: 'Park A', count: 1, submissionId: 'S100' },
        { speciesName: 'B', date: '2024-05-01T11:00:00.000Z', location: 'Park B', count: 2, submissionId: 'S100' },
        { speciesName: 'C', date: '2024-05-01T10:00:00.000Z', location: 'Park A', count: 1, submissionId: 'S200' },
      ]

      const { outings, observations } = groupPreviewsIntoOutings(previews, 'u1')
      // S100 → 1 outing, S200 → 1 outing
      expect(outings).toHaveLength(2)
      // S100 outing has 2 species, S200 has 1
      const s100Outing = outings.find(o => o.locationName === 'Park A' || o.locationName === 'Park B')
      expect(s100Outing).toBeDefined()
    })

    it('falls back to date+location when submissionId not present', () => {
      const previews = [
        { speciesName: 'A', date: '2024-05-01T10:00:00.000Z', location: 'Park', count: 1 },
        { speciesName: 'B', date: '2024-05-01T11:00:00.000Z', location: 'Park', count: 2 },
      ]

      const { outings } = groupPreviewsIntoOutings(previews, 'u1')
      expect(outings).toHaveLength(1) // same date + location → 1 outing
    })

    it('falls back to date+location when submission IDs are unique per row', () => {
      const previews = [
        { speciesName: 'A', date: '2024-05-01T10:00:00.000Z', location: 'Park', count: 1, submissionId: 'S1' },
        { speciesName: 'B', date: '2024-05-01T11:00:00.000Z', location: 'Park', count: 2, submissionId: 'S2' },
      ]

      const { outings } = groupPreviewsIntoOutings(previews, 'u1')
      expect(outings).toHaveLength(1)
    })

    it('carries checklist comments into outing notes', () => {
      const previews = [
        {
          speciesName: 'Mallard',
          date: '2024-05-01T10:00:00.000Z',
          location: 'Lake',
          count: 1,
          checklistNotes: 'Sunny day',
        },
      ]

      const { outings } = groupPreviewsIntoOutings(previews, 'u1')
      expect(outings[0].notes).toContain('Sunny day')
      expect(outings[0].notes).toContain('Imported from eBird')
    })

    it('carries observation details into observation notes', () => {
      const previews = [
        {
          speciesName: 'Mallard',
          date: '2024-05-01T10:00:00.000Z',
          location: 'Lake',
          count: 1,
          observationNotes: 'Flying overhead',
        },
      ]

      const { observations } = groupPreviewsIntoOutings(previews, 'u1')
      expect(observations[0].notes).toBe('Flying overhead')
    })
  })

  /* ---------- export tests ---------- */

  describe('dex CSV export', () => {
    it('uses ISO date format (YYYY-MM-DD) instead of locale-dependent format', () => {
      const dex: DexEntry[] = [
        {
          speciesName: 'Mallard (Anas platyrhynchos)',
          firstSeenDate: '2024-01-15T00:00:00.000Z',
          lastSeenDate: '2024-12-25T00:00:00.000Z',
          totalOutings: 3,
          totalCount: 10,
          notes: '',
        },
      ]

      const csv = exportDexToCSV(dex)
      expect(csv).toContain('"2024-01-15"')
      expect(csv).toContain('"2024-12-25"')
      // Should NOT contain locale-dependent formats
      expect(csv).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/)
    })

    it('splits species name into Common Name and Scientific Name columns', () => {
      const dex: DexEntry[] = [
        {
          speciesName: 'Bald Eagle (Haliaeetus leucocephalus)',
          firstSeenDate: '2025-06-01T00:00:00.000Z',
          lastSeenDate: '2025-06-01T00:00:00.000Z',
          totalOutings: 1,
          totalCount: 1,
          notes: '',
        },
      ]

      const csv = exportDexToCSV(dex)
      const [header, row] = csv.split('\n')
      expect(header).toContain('"Common Name"')
      expect(header).toContain('"Scientific Name"')
      expect(row).toContain('"Bald Eagle"')
      expect(row).toContain('"Haliaeetus leucocephalus"')
    })

    it('handles species without scientific name', () => {
      const dex: DexEntry[] = [
        {
          speciesName: 'Mystery Bird',
          firstSeenDate: '2025-06-01T00:00:00.000Z',
          lastSeenDate: '2025-06-01T00:00:00.000Z',
          totalOutings: 1,
          totalCount: 1,
          notes: '',
        },
      ]

      const csv = exportDexToCSV(dex)
      const [, row] = csv.split('\n')
      expect(row).toContain('"Mystery Bird"')
      expect(row).toContain('""') // empty scientific name
    })

    it('CSV-escapes header row', () => {
      const csv = exportDexToCSV([])
      const [header] = csv.split('\n')
      // Every header cell should be quoted
      const cells = header.split(',')
      for (const cell of cells) {
        expect(cell).toMatch(/^".*"$/)
      }
    })
  })

  describe('outing CSV export', () => {
    it('uses "X" for zero-count observations', () => {
      const outing: Outing = {
        id: 'o1',
        userId: 'u1',
        startTime: '2024-05-01T12:00:00.000Z',
        endTime: '2024-05-01T13:00:00.000Z',
        locationName: 'Park',
        notes: '',
        createdAt: '2024-05-01T12:00:00.000Z',
      }
      const observations: Observation[] = [
        {
          id: 'obs_1',
          outingId: 'o1',
          speciesName: 'Mallard (Anas platyrhynchos)',
          count: 0,
          certainty: 'confirmed',
          notes: '',
        },
      ]

      const csv = exportOutingToEBirdCSV(outing, observations)
      expect(csv).toContain('"X"')
    })

    it('excludes non-confirmed observations', () => {
      const outing: Outing = {
        id: 'o1',
        userId: 'u1',
        startTime: '2024-05-01T12:00:00.000Z',
        endTime: '2024-05-01T13:00:00.000Z',
        locationName: 'Park',
        notes: '',
        createdAt: '2024-05-01T12:00:00.000Z',
      }
      const observations: Observation[] = [
        {
          id: 'obs_1',
          outingId: 'o1',
          speciesName: 'Mallard (Anas platyrhynchos)',
          count: 1,
          certainty: 'confirmed',
          notes: '',
        },
        {
          id: 'obs_2',
          outingId: 'o1',
          speciesName: 'Eagle (Aquila chrysaetos)',
          count: 1,
          certainty: 'possible',
          notes: '',
        },
        {
          id: 'obs_3',
          outingId: 'o1',
          speciesName: 'Hawk (Buteo jamaicensis)',
          count: 1,
          certainty: 'rejected',
          notes: '',
        },
      ]

      const csv = exportOutingToEBirdCSV(outing, observations)
      expect(csv).toContain('"Mallard"')
      expect(csv).not.toContain('"Eagle"')
      expect(csv).not.toContain('"Hawk"')
    })

    it('formats date as MM/DD/YYYY for eBird Record format', () => {
      const outing: Outing = {
        id: 'o1',
        userId: 'u1',
        startTime: '2025-09-28T08:15:00.000Z',
        endTime: '2025-09-28T09:15:00.000Z',
        locationName: 'Park',
        notes: '',
        createdAt: '2025-09-28T08:15:00.000Z',
      }
      const observations: Observation[] = [
        {
          id: 'obs_1',
          outingId: 'o1',
          speciesName: 'Mallard (Anas platyrhynchos)',
          count: 1,
          certainty: 'confirmed',
          notes: '',
        },
      ]

      const csv = exportOutingToEBirdCSV(outing, observations)
      // Date should be in MM/DD/YYYY format
      expect(csv).toMatch(/"0?\d\/\d{2}\/2025"/)
    })

    it('includes lat/lon with 6 decimal places', () => {
      const outing: Outing = {
        id: 'o1',
        userId: 'u1',
        startTime: '2024-05-01T12:00:00.000Z',
        endTime: '2024-05-01T13:00:00.000Z',
        locationName: 'Smith Island',
        lat: 48.320427,
        lon: -122.83517,
        notes: '',
        createdAt: '2024-05-01T12:00:00.000Z',
      }
      const observations: Observation[] = [
        {
          id: 'obs_1',
          outingId: 'o1',
          speciesName: 'Tufted Puffin (Fratercula cirrhata)',
          count: 1,
          certainty: 'confirmed',
          notes: '',
        },
      ]

      const csv = exportOutingToEBirdCSV(outing, observations)
      expect(csv).toContain('"48.320427"')
      expect(csv).toContain('"-122.835170"')
    })

    it('produces exactly 19 columns per row matching eBird Record spec', () => {
      const outing: Outing = {
        id: 'o1',
        userId: 'u1',
        startTime: '2024-05-01T12:00:00.000Z',
        endTime: '2024-05-01T13:00:00.000Z',
        locationName: 'Park',
        lat: 47.6,
        lon: -122.3,
        notes: 'Test notes',
        createdAt: '2024-05-01T12:00:00.000Z',
      }
      const observations: Observation[] = [
        {
          id: 'obs_1',
          outingId: 'o1',
          speciesName: 'Mallard (Anas platyrhynchos)',
          count: 3,
          certainty: 'confirmed',
          notes: 'Near pond',
        },
        {
          id: 'obs_2',
          outingId: 'o1',
          speciesName: 'Great Blue Heron (Ardea herodias)',
          count: 1,
          certainty: 'confirmed',
          notes: '',
        },
      ]

      const csv = exportOutingToEBirdCSV(outing, observations, { includeHeader: true })
      const lines = csv.split('\n')
      expect(lines).toHaveLength(3) // header + 2 rows

      for (const line of lines) {
        // Count commas that are between quoted fields (not inside quotes)
        const fields = parseCSVLineForTest(line)
        expect(fields).toHaveLength(19)
      }
    })
  })

  /* ---------- extractSavedSpotsFromPreviews ---------- */

  describe('extractSavedSpotsFromPreviews', () => {
    it('extracts unique locations with coordinates from previews', () => {
      const previews = parseEBirdCSV(ebirdCSV([
        'S1,Mallard,Anas platyrhynchos,545,X,US-WA,King,,Union Bay,47.654268,-122.295243,2025-11-08,09:46 AM,eBird - Casual Observation,,0,,,1',
        'S2,Bald Eagle,Haliaeetus leucocephalus,8367,X,US-WA,King,,The Arboretum,47.642651,-122.288885,2025-06-01,10:24 AM,eBird - Casual Observation,,0,,,1',
        'S3,Northern Shoveler,Spatula clypeata,501,X,US-WA,King,,Union Bay,47.654268,-122.295243,2025-11-08,09:48 AM,eBird - Casual Observation,,0,,,1',
      ]))

      const spots = extractSavedSpotsFromPreviews(previews)
      expect(spots).toHaveLength(2)
      const names = spots.map(s => s.name).sort()
      expect(names).toEqual(['The Arboretum', 'Union Bay'])
      const unionBay = spots.find(s => s.name === 'Union Bay')!
      expect(unionBay.lat).toBeCloseTo(47.654268, 4)
      expect(unionBay.lon).toBeCloseTo(-122.295243, 4)
    })

    it('skips locations already saved by name (case-insensitive)', () => {
      const previews = parseEBirdCSV(ebirdCSV([
        'S1,Mallard,Anas platyrhynchos,545,X,US-WA,King,,Home,47.64,-122.40,2025-06-01,11:07 AM,eBird - Casual Observation,,0,,,1',
        'S2,Bald Eagle,Haliaeetus leucocephalus,8367,X,US-WA,King,,New Spot,47.65,-122.29,2025-06-01,10:24 AM,eBird - Casual Observation,,0,,,1',
      ]))

      const existing: SavedSpot[] = [{
        id: 'spot_1', name: 'home', lat: 47.64, lon: -122.40, createdAt: '2025-01-01T00:00:00.000Z',
      }]

      const spots = extractSavedSpotsFromPreviews(previews, existing)
      expect(spots).toHaveLength(1)
      expect(spots[0].name).toBe('New Spot')
    })

    it('skips locations already saved by proximity (~500m)', () => {
      const previews = parseEBirdCSV(ebirdCSV([
        'S1,Mallard,Anas platyrhynchos,545,X,US-WA,King,,Near Home,47.6401,-122.4001,2025-06-01,11:07 AM,eBird - Casual Observation,,0,,,1',
      ]))

      const existing: SavedSpot[] = [{
        id: 'spot_1', name: 'My Home', lat: 47.64, lon: -122.40, createdAt: '2025-01-01T00:00:00.000Z',
      }]

      const spots = extractSavedSpotsFromPreviews(previews, existing)
      expect(spots).toHaveLength(0)
    })

    it('includes locations without coordinates (lat/lon default to 0)', () => {
      const previews = [
        { speciesName: 'Mallard', date: '2024-05-01T10:00:00.000Z', location: 'Mystery Spot', count: 1 },
      ]

      const spots = extractSavedSpotsFromPreviews(previews)
      expect(spots).toHaveLength(1)
      expect(spots[0].name).toBe('Mystery Spot')
      expect(spots[0].lat).toBe(0)
      expect(spots[0].lon).toBe(0)
    })

    it('skips "Unknown" locations', () => {
      const previews = [
        { speciesName: 'Mallard', date: '2024-05-01T10:00:00.000Z', location: 'Unknown', count: 1 },
      ]

      const spots = extractSavedSpotsFromPreviews(previews)
      expect(spots).toHaveLength(0)
    })
  })
})
