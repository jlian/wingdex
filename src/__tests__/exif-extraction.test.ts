import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Unit test for EXIF extraction.
 * Verifies that GPS and timestamp are correctly parsed from bird-test.jpeg.
 * Uses a pure-Node reimplementation of the EXIF parser to avoid DOM dependencies.
 */

function parseEXIF(buffer: Buffer): {
  timestamp?: string
  gps?: { lat: number; lon: number }
} {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  if (view.getUint16(0) !== 0xffd8) return {}

  let offset = 2
  const result: { timestamp?: string; gps?: { lat: number; lon: number } } = {}

  while (offset < view.byteLength) {
    const marker = view.getUint16(offset)
    if (marker === 0xffe1) {
      const exifStart = offset + 4
      if (view.getUint32(exifStart) === 0x45786966) {
        const tiffOffset = exifStart + 6
        const littleEndian = view.getUint16(tiffOffset) === 0x4949

        try {
          const ifdOffset = view.getUint32(tiffOffset + 4, littleEndian)
          const numEntries = view.getUint16(tiffOffset + ifdOffset, littleEndian)

          for (let i = 0; i < numEntries; i++) {
            const entryOffset = tiffOffset + ifdOffset + 2 + i * 12
            const tag = view.getUint16(entryOffset, littleEndian)

            if (tag === 0x0132 || tag === 0x9003) {
              const valueOffset = view.getUint32(entryOffset + 8, littleEndian)
              let dateStr = ''
              for (let j = 0; j < 19; j++) {
                const char = view.getUint8(tiffOffset + valueOffset + j)
                if (char === 0) break
                dateStr += String.fromCharCode(char)
              }
              if (dateStr) {
                result.timestamp = dateStr.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
              }
            }

            if (tag === 0x8825) {
              const gpsIfdOffset = view.getUint32(entryOffset + 8, littleEndian)
              const gps = parseGPS(view, tiffOffset, gpsIfdOffset, littleEndian)
              if (gps) result.gps = gps
            }
          }
        } catch { /* ignore */ }
      }
      break
    }
    offset += 2 + view.getUint16(offset + 2)
  }

  return result
}

function parseGPS(
  view: DataView,
  tiffOffset: number,
  gpsIfdOffset: number,
  littleEndian: boolean
): { lat: number; lon: number } | null {
  try {
    const numEntries = view.getUint16(tiffOffset + gpsIfdOffset, littleEndian)
    let lat = 0, lon = 0, latRef = '', lonRef = ''

    for (let i = 0; i < numEntries; i++) {
      const entryOffset = tiffOffset + gpsIfdOffset + 2 + i * 12
      const tag = view.getUint16(entryOffset, littleEndian)
      const type = view.getUint16(entryOffset + 2, littleEndian)
      const count = view.getUint32(entryOffset + 4, littleEndian)

      const typeSize: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 }
      const totalBytes = (typeSize[type] || 1) * count
      const isInline = totalBytes <= 4
      const dataOffset = isInline
        ? entryOffset + 8
        : tiffOffset + view.getUint32(entryOffset + 8, littleEndian)

      if (tag === 1) latRef = String.fromCharCode(view.getUint8(dataOffset))
      else if (tag === 3) lonRef = String.fromCharCode(view.getUint8(dataOffset))
      else if (tag === 2) {
        const d = view.getUint32(dataOffset, littleEndian) / view.getUint32(dataOffset + 4, littleEndian)
        const m = view.getUint32(dataOffset + 8, littleEndian) / view.getUint32(dataOffset + 12, littleEndian)
        const s = view.getUint32(dataOffset + 16, littleEndian) / view.getUint32(dataOffset + 20, littleEndian)
        lat = d + m / 60 + s / 3600
      } else if (tag === 4) {
        const d = view.getUint32(dataOffset, littleEndian) / view.getUint32(dataOffset + 4, littleEndian)
        const m = view.getUint32(dataOffset + 8, littleEndian) / view.getUint32(dataOffset + 12, littleEndian)
        const s = view.getUint32(dataOffset + 16, littleEndian) / view.getUint32(dataOffset + 20, littleEndian)
        lon = d + m / 60 + s / 3600
      }
    }

    if (lat && lon) {
      return {
        lat: latRef === 'S' ? -lat : lat,
        lon: lonRef === 'W' ? -lon : lon,
      }
    }
  } catch { /* ignore */ }
  return null
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
  const buffer = readFileSync(imagePath)
  const slice = buffer.subarray(0, 128 * 1024)
  const exif = parseEXIF(slice)

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
      const buffer = readFileSync(imagePath)
      const slice = buffer.subarray(0, 128 * 1024)
      const exif = parseEXIF(slice)

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
