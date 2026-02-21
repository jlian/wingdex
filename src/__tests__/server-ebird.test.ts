/**
 * Tests for the server-side eBird module (functions/lib/ebird.ts).
 *
 * The server eBird module is a separate copy of the client eBird parsing
 * logic ported to the Cloudflare Functions runtime. These tests verify the
 * server module loads correctly and handles the core parse/group/export flows.
 */
import { describe, it, expect } from 'vitest'
import {
  parseEBirdCSV,
  groupPreviewsIntoOutings,
  detectImportConflicts,
  exportOutingToEBirdCSV,
  exportDexToCSV,
} from '../../functions/lib/ebird'

const SAMPLE_CSV = `Submission ID,Common Name,Scientific Name,Taxonomic Order,Count,State/Province,County,Location,Latitude,Longitude,Date,Time,Protocol,Duration (Min),All Obs Reported,Distance Traveled (km),Area Covered (ha),Number of Observers,Breeding Code,Observation Details,Checklist Comments,ML Catalog Numbers
S123456789,Northern Cardinal,Cardinalis cardinalis,34602,2,US-WA,King,Discovery Park,47.6606,-122.4147,2025-09-28,08:15 AM,eBird - Traveling Count,60,1,2.5,,1,,,Sunny morning,
S123456789,Bald Eagle,Haliaeetus leucocephalus,3302,1,US-WA,King,Discovery Park,47.6606,-122.4147,2025-09-28,08:15 AM,eBird - Traveling Count,60,1,2.5,,1,,Soaring overhead,,`

describe('server eBird module', () => {
  describe('parseEBirdCSV', () => {
    it('parses standard eBird CSV rows', () => {
      const previews = parseEBirdCSV(SAMPLE_CSV)
      expect(previews).toHaveLength(2)
      expect(previews[0].speciesName).toBe('Northern Cardinal (Cardinalis cardinalis)')
      expect(previews[0].count).toBe(2)
      expect(previews[0].location).toBe('Discovery Park')
      expect(previews[0].lat).toBeCloseTo(47.6606)
      expect(previews[0].lon).toBeCloseTo(-122.4147)
    })

    it('captures submission ID', () => {
      const previews = parseEBirdCSV(SAMPLE_CSV)
      expect(previews[0].submissionId).toBe('S123456789')
    })

    it('captures observation notes and checklist comments', () => {
      const previews = parseEBirdCSV(SAMPLE_CSV)
      // First row has checklist comment "Sunny morning", no observation details
      expect(previews[0].checklistNotes).toBe('Sunny morning')
      // Second row has observation detail "Soaring overhead"
      expect(previews[1].observationNotes).toBe('Soaring overhead')
    })
  })

  describe('groupPreviewsIntoOutings', () => {
    it('groups observations from the same checklist into one outing', () => {
      const previews = parseEBirdCSV(SAMPLE_CSV)
      const grouped = groupPreviewsIntoOutings(previews, 'test-user')
      expect(grouped.outings).toHaveLength(1)
      expect(grouped.observations).toHaveLength(2)
      expect(grouped.outings[0].locationName).toBe('Discovery Park')
    })

    it('assigns the specified userId to outings', () => {
      const previews = parseEBirdCSV(SAMPLE_CSV)
      const grouped = groupPreviewsIntoOutings(previews, 'u-abc')
      expect(grouped.outings[0].userId).toBe('u-abc')
      // observations reference outings by outingId, not userId directly
      expect(grouped.observations[0].outingId).toBe(grouped.outings[0].id)
    })
  })

  describe('detectImportConflicts', () => {
    it('marks species not in dex as new', () => {
      const previews = parseEBirdCSV(SAMPLE_CSV)
      const emptyDex = new Map()
      const withConflicts = detectImportConflicts(previews, emptyDex)
      expect(withConflicts.every(preview => preview.conflict === 'new')).toBe(true)
    })

    it('marks matching species with overlapping dates as duplicate', () => {
      const previews = parseEBirdCSV(SAMPLE_CSV)
      const cardinalName = previews[0].speciesName // 'Northern Cardinal (Cardinalis cardinalis)'
      const existingDex = new Map([[
        cardinalName,
        {
          speciesName: cardinalName,
          firstSeenDate: '2025-09-01T00:00:00-07:00',
          lastSeenDate: '2025-10-01T00:00:00-07:00',
          totalOutings: 1,
          totalCount: 1,
        },
      ]])
      const withConflicts = detectImportConflicts(previews, existingDex)
      const cardinal = withConflicts.find(preview => preview.speciesName === cardinalName)
      expect(cardinal?.conflict).toBe('duplicate')
    })
  })

  describe('exportOutingToEBirdCSV', () => {
    it('produces CSV with header and data rows', () => {
      const csv = exportOutingToEBirdCSV(
        {
          id: 'o1',
          startTime: '2025-09-28T08:15:00-07:00',
          locationName: 'Discovery Park',
          lat: 47.6606,
          lon: -122.4147,
        },
        [
          { speciesName: 'Northern Cardinal', count: 2, certainty: 'confirmed', notes: '' },
          { speciesName: 'Bald Eagle', count: 1, certainty: 'confirmed', notes: 'Soaring' },
        ]
      )

      const lines = csv.split('\n')
      expect(lines.length).toBeGreaterThanOrEqual(3) // header + 2 data rows
      expect(lines[0]).toContain('Common Name')
      expect(lines[1]).toContain('Northern Cardinal')
      expect(lines[2]).toContain('Bald Eagle')
    })
  })

  describe('exportDexToCSV', () => {
    it('exports dex entries as CSV', () => {
      const csv = exportDexToCSV([
        {
          speciesName: 'Northern Cardinal',
          firstSeenDate: '2025-09-28T08:15:00-07:00',
          lastSeenDate: '2025-09-28T08:15:00-07:00',
          totalOutings: 1,
          totalCount: 2,
          notes: '',
        },
      ])

      expect(csv).toContain('Northern Cardinal')
      expect(csv).toContain('2025-09-28')
    })
  })
})
