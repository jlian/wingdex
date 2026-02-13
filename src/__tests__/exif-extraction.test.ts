// @ts-nocheck — this test uses Node.js APIs (fs, path, __dirname) provided by vitest
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { parseEXIF } from '@/lib/photo-utils'

/**
 * Unit test for EXIF extraction.
 * Verifies that GPS and timestamp are correctly parsed from bird photos.
 * Imports the actual parseEXIF function from photo-utils.ts.
 */

/** Helper to create a DataView from a file buffer (first 128KB, matching extractEXIF) */
function loadExifView(filePath: string): DataView {
  const buffer = readFileSync(filePath)
  const slice = buffer.subarray(0, 128 * 1024)
  return new DataView(slice.buffer, slice.byteOffset, slice.byteLength)
}

/** All test images with expected EXIF metadata */
const TEST_IMAGES: Array<{
  file: string
  species: string
  date: string        // YYYY-MM-DD prefix expected in timestamp
  lat: number         // expected latitude (approx)
  lon: number         // expected longitude (approx)
  location: string    // human description
  toleranceKm: number
}> = [
  {
    file: 'bird-test.jpeg',
    species: 'Common Kingfisher',
    date: '2025-12-27',
    lat: 24.998, lon: 121.581,
    location: 'Taipei Zoo',
    toleranceKm: 5,
  },
  {
    file: 'belted-kingfisher.jpg',
    species: 'Belted Kingfisher',
    date: '2024-08-10',
    lat: 47.6646, lon: -122.3974,
    location: 'Carkeek Park, Seattle',
    toleranceKm: 5,
  },
  {
    file: 'stellers-jay.jpg',
    species: "Steller's Jay",
    date: '2025-06-17',
    lat: 47.6399, lon: -122.4039,
    location: 'Seattle backyard',
    toleranceKm: 5,
  },
  {
    file: 'great-blue-heron.jpg',
    species: 'Great Blue Heron',
    date: '2024-08-10',
    lat: 47.7117, lon: -122.3771,
    location: 'Carkeek Park, Seattle',
    toleranceKm: 5,
  },
  {
    file: 'chukar-partridge.jpg',
    species: 'Chukar Partridge',
    date: '2024-12-18',
    lat: 20.7148, lon: -156.2502,
    location: 'Haleakalā summit, Maui',
    toleranceKm: 10,
  },
  {
    file: 'tufted-puffin.jpg',
    species: 'Tufted Puffin',
    date: '2025-08-16',
    lat: 48.3252, lon: -122.8434,
    location: 'Smith Island, WA',
    toleranceKm: 10,
  },
]

describe('EXIF extraction from bird-test.jpeg', () => {
  const imagePath = resolve(__dirname, '../assets/images/bird-test.jpeg')
  const view = loadExifView(imagePath)
  const exif = parseEXIF(view)

  it('extracts timestamp', () => {
    expect(exif.timestamp).toBeDefined()
    expect(exif.timestamp).toContain('2025-12-27')
  })

  it('extracts GPS coordinates', () => {
    expect(exif.gps).toBeDefined()
    expect(exif.gps!.lat).toBeGreaterThan(24.9)
    expect(exif.gps!.lat).toBeLessThan(25.1)
    expect(exif.gps!.lon).toBeGreaterThan(121.5)
    expect(exif.gps!.lon).toBeLessThan(121.7)
  })

  it('GPS coordinates are in Taipei Zoo area', () => {
    const lat = exif.gps!.lat
    const lon = exif.gps!.lon
    const distKm = Math.sqrt(
      Math.pow((lat - 24.998) * 111, 2) + Math.pow((lon - 121.581) * 101, 2)
    )
    expect(distKm).toBeLessThan(5)
  })
})

describe('EXIF extraction across all test images', () => {
  for (const img of TEST_IMAGES) {
    describe(img.species + ' (' + img.file + ')', () => {
      const imagePath = resolve(__dirname, '../assets/images/' + img.file)
      const view = loadExifView(imagePath)
      const exif = parseEXIF(view)

      it('extracts timestamp containing ' + img.date, () => {
        expect(exif.timestamp).toBeDefined()
        expect(exif.timestamp).toContain(img.date)
      })

      it('extracts GPS coordinates near ' + img.location, () => {
        expect(exif.gps).toBeDefined()
        const latDelta = Math.abs(exif.gps!.lat - img.lat)
        const lonDelta = Math.abs(exif.gps!.lon - img.lon)
        // Rough km conversion: 1° lat ≈ 111km, 1° lon ≈ 101km (mid-latitudes)
        const distKm = Math.sqrt(
          Math.pow(latDelta * 111, 2) + Math.pow(lonDelta * 101, 2)
        )
        expect(distKm).toBeLessThan(img.toleranceKm)
      })
    })
  }
})
