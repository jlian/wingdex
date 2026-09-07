import { embeddedJpegPreviews, tiffByteOrder } from '@/lib/raw-preview'

export class PhotoDecodeError extends Error {
  constructor() {
    super('This browser could not decode the photo or an embedded JPEG preview. Export a JPEG copy and try again.')
    this.name = 'PhotoDecodeError'
  }
}

export async function extractEXIF(file: File): Promise<{
  timestamp?: string
  gps?: { lat: number; lon: number }
}> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    
    reader.onload = (e) => {
      try {
        const view = new DataView(e.target?.result as ArrayBuffer)
        const exif = parseEXIF(view)
        resolve(exif)
      } catch {
        resolve({})
      }
    }
    
    reader.onerror = () => resolve({})
    reader.readAsArrayBuffer(file.slice(0, 128 * 1024))
  })
}

export function parseEXIF(view: DataView): {
  timestamp?: string
  gps?: { lat: number; lon: number }
} {
  const result: { timestamp?: string; gps?: { lat: number; lon: number } } = {}
  if (view.byteLength < 8) return result
  let tiffOffset = 0
  let offset = 2
  while (view.getUint16(0) === 0xffd8 && offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset)
    if (marker === 0xffda || marker === 0xffd9) break
    const size = view.getUint16(offset + 2)
    if (size < 2 || offset + 2 + size > view.byteLength) break
    if (marker === 0xffe1 && size >= 16
      && view.getUint32(offset + 4) === 0x45786966
      && view.getUint16(offset + 8) === 0) {
      tiffOffset = offset + 10
      break
    }
    offset += 2 + size
  }

  const littleEndian = tiffByteOrder(view, tiffOffset)
  if (littleEndian === undefined) return result
  const pending = [view.getUint32(tiffOffset + 4, littleEndian)]
  const visited = new Set<number>()
  while (pending.length && visited.size < 64) {
    const ifdOffset = pending.shift()!
    if (!ifdOffset || visited.has(ifdOffset)) continue
    visited.add(ifdOffset)
    try {
      const numEntries = view.getUint16(tiffOffset + ifdOffset, littleEndian)
      if (numEntries > 4096) continue
      for (let i = 0; i < numEntries; i++) {
        const entryOffset = tiffOffset + ifdOffset + 2 + i * 12
        const tag = view.getUint16(entryOffset, littleEndian)
        const type = view.getUint16(entryOffset + 2, littleEndian)
        const count = view.getUint32(entryOffset + 4, littleEndian)
        const valueOffset = view.getUint32(entryOffset + 8, littleEndian)
        if ((tag === 0x0132 || tag === 0x9003) && type === 2 && count >= 19
          && (tag === 0x9003 || !result.timestamp)) {
          let dateStr = ''
          for (let j = 0; j < 19; j++) {
            const char = view.getUint8(tiffOffset + valueOffset + j)
            if (char === 0) break
            dateStr += String.fromCharCode(char)
          }
          if (dateStr) result.timestamp = dateStr.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
        }
        if (tag === 0x8769 && type === 4 && count === 1) pending.push(valueOffset)
        if (tag === 0x8825 && type === 4 && count === 1) {
          const gps = parseGPS(view, tiffOffset, valueOffset, littleEndian)
          if (gps) result.gps = gps
        }
      }
    } catch {
      // Truncated optional metadata must not prevent importing the image.
    }
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
      
      // For small values (<=4 bytes), data is stored inline at entryOffset+8
      // For larger values, entryOffset+8 holds an offset into the TIFF data
      const typeSize: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 }
      const totalBytes = (typeSize[type] || 1) * count
      const isInline = totalBytes <= 4
      const dataOffset = isInline
        ? entryOffset + 8
        : tiffOffset + view.getUint32(entryOffset + 8, littleEndian)
      
      if (tag === 1) { // GPSLatitudeRef
        latRef = String.fromCharCode(view.getUint8(dataOffset))
      } else if (tag === 3) { // GPSLongitudeRef
        lonRef = String.fromCharCode(view.getUint8(dataOffset))
      } else if (tag === 2) { // GPSLatitude (3 rationals = 24 bytes, always offset)
        const d = view.getUint32(dataOffset, littleEndian) / view.getUint32(dataOffset + 4, littleEndian)
        const m = view.getUint32(dataOffset + 8, littleEndian) / view.getUint32(dataOffset + 12, littleEndian)
        const s = view.getUint32(dataOffset + 16, littleEndian) / view.getUint32(dataOffset + 20, littleEndian)
        lat = d + m / 60 + s / 3600
      } else if (tag === 4) { // GPSLongitude (3 rationals = 24 bytes, always offset)
        const d = view.getUint32(dataOffset, littleEndian) / view.getUint32(dataOffset + 4, littleEndian)
        const m = view.getUint32(dataOffset + 8, littleEndian) / view.getUint32(dataOffset + 12, littleEndian)
        const s = view.getUint32(dataOffset + 16, littleEndian) / view.getUint32(dataOffset + 20, littleEndian)
        lon = d + m / 60 + s / 3600
      }
    }
    
    if (lat && lon) {
      return {
        lat: latRef === 'S' ? -lat : lat,
        lon: lonRef === 'W' ? -lon : lon
      }
    }
  } catch {
  }
  return null
}

export async function generateThumbnail(file: Blob, maxWidth = 400): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    
    img.onload = () => {
      try {
        if (!img.width || !img.height) throw new PhotoDecodeError()
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          throw new Error('Canvas not supported')
        }

        const scale = Math.min(maxWidth / img.width, 1)
        canvas.width = img.width * scale
        canvas.height = img.height * scale

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.8))
      } catch (error) {
        reject(error)
      } finally {
        URL.revokeObjectURL(url)
      }
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new PhotoDecodeError())
    }
    
    img.src = url
  })
}

export async function preparePhotoImage(file: File): Promise<{ image: Blob; thumbnail: string }> {
  try {
    return { image: file, thumbnail: await generateThumbnail(file) }
  } catch (error) {
    if (!(error instanceof PhotoDecodeError)) throw error
    // Keep browser/Photos conversion first. The fallback checks the container,
    // not its extension; unrelated or unsupported layouts yield no previews.
    for await (const image of embeddedJpegPreviews(file)) {
      try {
        return { image, thumbnail: await generateThumbnail(image) }
      } catch (error) {
        if (!(error instanceof PhotoDecodeError)) throw error
        // A damaged preview must not hide another decodable camera render.
      }
    }
    throw new PhotoDecodeError()
  }
}

/**
 * Compute a fast content-addressable hash for duplicate detection.
 *
 * Hashes the first 64KB + last 64KB + file size instead of the full file.
 * This is intentional: photo files differ in EXIF headers (first bytes) and
 * compressed image data (tail bytes), and the size acts as an additional
 * discriminator. Combined with the EXIF timestamp check in AddPhotosFlow,
 * the collision risk for distinct photos is negligible in practice.
 */
export async function computeFileHash(file: File): Promise<string> {
  const chunkSize = 64 * 1024

  let content: ArrayBuffer
  if (file.size <= chunkSize * 2) {
    content = await file.arrayBuffer()
  } else {
    const firstChunk = await file.slice(0, chunkSize).arrayBuffer()
    const lastChunk = await file.slice(file.size - chunkSize, file.size).arrayBuffer()
    const merged = new Uint8Array(firstChunk.byteLength + lastChunk.byteLength)
    merged.set(new Uint8Array(firstChunk), 0)
    merged.set(new Uint8Array(lastChunk), firstChunk.byteLength)
    content = merged.buffer
  }

  const sizeBytes = new TextEncoder().encode(String(file.size))
  const final = new Uint8Array(content.byteLength + sizeBytes.byteLength)
  final.set(new Uint8Array(content), 0)
  final.set(sizeBytes, content.byteLength)

  const hashBuffer = await crypto.subtle.digest('SHA-256', final)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}
