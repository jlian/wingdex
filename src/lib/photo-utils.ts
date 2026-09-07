import { embeddedJpegPreviews, tiffByteOrder } from '@/lib/raw-preview'

export class PhotoDecodeError extends Error {
  constructor() {
    super('This browser could not decode the photo or an embedded JPEG preview. Export a JPEG copy and try again.')
    this.name = 'PhotoDecodeError'
  }
}

export async function extractEXIF(file: Blob): Promise<{
  timestamp?: string
  gps?: { lat: number; lon: number }
}> {
  const read = async (offset: number, length: number) => {
    if (offset < 0 || length < 0 || offset + length > file.size) return undefined
    return new DataView(await file.slice(offset, offset + length).arrayBuffer())
  }
  return await parseExifAsync(read, file.size)
}

async function parseExifAsync(
  read: (offset: number, length: number) => Promise<DataView | undefined>,
  fileSize: number
): Promise<{ timestamp?: string; gps?: { lat: number; lon: number } }> {
  const result: { timestamp?: string; gps?: { lat: number; lon: number } } = {}
  const header = await read(0, 8)
  if (!header || header.byteLength < 8) return result

  let tiffOffset = 0
  if (header.getUint16(0) === 0xffd8) {
    let pos = 2
    let found = false
    const maxMarkers = 64
    let markers = 0
    while (pos + 4 <= fileSize && markers < maxMarkers) {
      markers++
      const seg = await read(pos, 4)
      if (!seg || seg.getUint8(0) !== 0xff) break
      const marker = seg.getUint8(1)
      if (marker === 0xd9 || marker === 0xda) break
      const size = seg.getUint16(2)
      if (size < 2 || pos + 2 + size > fileSize) break
      if (marker === 0xe1 && size >= 16) {
        const id = await read(pos + 4, 6)
        if (id && id.getUint32(0) === 0x45786966 && id.getUint16(4) === 0) {
          tiffOffset = pos + 10
          found = true
          break
        }
      }
      pos += 2 + size
    }
    if (!found) return result
  }

  const tiffHead = await read(tiffOffset, 8)
  if (!tiffHead || tiffHead.byteLength < 8) return result
  const littleEndian = tiffByteOrder(tiffHead)
  if (littleEndian === undefined) return result

  const pending = [tiffHead.getUint32(4, littleEndian)]
  const visited = new Set<number>()
  while (pending.length && visited.size < 64) {
    const ifdOffset = pending.shift()!
    if (!ifdOffset || visited.has(ifdOffset) || tiffOffset + ifdOffset + 2 > fileSize) continue
    visited.add(ifdOffset)
    try {
      const countView = await read(tiffOffset + ifdOffset, 2)
      if (!countView) continue
      const numEntries = countView.getUint16(0, littleEndian)
      if (numEntries > 4096 || tiffOffset + ifdOffset + 2 + numEntries * 12 > fileSize) continue

      const dirView = await read(tiffOffset + ifdOffset + 2, numEntries * 12)
      if (!dirView) continue

      for (let i = 0; i < numEntries; i++) {
        const entryOffset = i * 12
        const tag = dirView.getUint16(entryOffset, littleEndian)
        const type = dirView.getUint16(entryOffset + 2, littleEndian)
        const count = dirView.getUint32(entryOffset + 4, littleEndian)
        const valueOffset = dirView.getUint32(entryOffset + 8, littleEndian)

        if ((tag === 0x0132 || tag === 0x9003) && type === 2 && count >= 19
          && (tag === 0x9003 || !result.timestamp)) {
          const strView = count <= 4
            ? new DataView(dirView.buffer, dirView.byteOffset + entryOffset + 8, count)
            : await read(tiffOffset + valueOffset, Math.min(count, 19))
          if (strView) {
            let dateStr = ''
            for (let j = 0; j < 19; j++) {
              const char = strView.getUint8(j)
              if (char === 0) break
              dateStr += String.fromCharCode(char)
            }
            if (dateStr) result.timestamp = dateStr.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
          }
        }
        if (tag === 0x8769 && (type === 4 || type === 13) && count === 1) pending.push(valueOffset)
        if (tag === 0x8825 && (type === 4 || type === 13) && count === 1) {
          const gps = await parseGPSAsync(read, tiffOffset, valueOffset, littleEndian, fileSize)
          if (gps) result.gps = gps
        }
      }
    } catch (error) {
      if (!(error instanceof RangeError) && !(error instanceof TypeError)) {
        throw error
      }
      // Truncated optional metadata must not prevent importing the image.
    }
  }
  return result
}

async function parseGPSAsync(
  read: (offset: number, length: number) => Promise<DataView | undefined>,
  tiffOffset: number,
  gpsIfdOffset: number,
  littleEndian: boolean,
  fileSize: number
): Promise<{ lat: number; lon: number } | null> {
  try {
    if (tiffOffset + gpsIfdOffset + 2 > fileSize) return null
    const countView = await read(tiffOffset + gpsIfdOffset, 2)
    if (!countView) return null
    const numEntries = countView.getUint16(0, littleEndian)
    if (numEntries > 4096 || tiffOffset + gpsIfdOffset + 2 + numEntries * 12 > fileSize) return null

    const dirView = await read(tiffOffset + gpsIfdOffset + 2, numEntries * 12)
    if (!dirView) return null

    let lat = 0, lon = 0, latRef = '', lonRef = ''
    for (let i = 0; i < numEntries; i++) {
      const entryOffset = i * 12
      const tag = dirView.getUint16(entryOffset, littleEndian)
      const type = dirView.getUint16(entryOffset + 2, littleEndian)
      const count = dirView.getUint32(entryOffset + 4, littleEndian)
      const rawOffset = dirView.getUint32(entryOffset + 8, littleEndian)

      if (tag === 1) {
        latRef = String.fromCharCode(dirView.getUint8(entryOffset + 8))
      } else if (tag === 3) {
        lonRef = String.fromCharCode(dirView.getUint8(entryOffset + 8))
      } else if (tag === 2 || tag === 4) {
        const typeSize: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 }
        const totalBytes = (typeSize[type] || 1) * count
        const isInline = totalBytes <= 4
        const valView = isInline
          ? new DataView(dirView.buffer, dirView.byteOffset + entryOffset + 8, totalBytes)
          : await read(tiffOffset + rawOffset, 24)
        if (valView && valView.byteLength >= 24) {
          const d = valView.getUint32(0, littleEndian) / valView.getUint32(4, littleEndian)
          const m = valView.getUint32(8, littleEndian) / valView.getUint32(12, littleEndian)
          const s = valView.getUint32(16, littleEndian) / valView.getUint32(20, littleEndian)
          const val = d + m / 60 + s / 3600
          if (tag === 2) lat = val
          else lon = val
        }
      }
    }

    if (lat && lon) {
      return {
        lat: latRef === 'S' ? -lat : lat,
        lon: lonRef === 'W' ? -lon : lon,
      }
    }
  } catch (error) {
    if (!(error instanceof RangeError) && !(error instanceof TypeError)) {
      throw error
    }
  }
  return null
}

export function parseEXIF(view: DataView): {
  timestamp?: string
  gps?: { lat: number; lon: number }
} {
  const read = (offset: number, length: number) => {
    if (offset < 0 || length < 0 || offset + length > view.byteLength) return undefined
    return new DataView(view.buffer, view.byteOffset + offset, length)
  }
  return parseExifSync(read, view.byteLength)
}

function parseExifSync(
  read: (offset: number, length: number) => DataView | undefined,
  fileSize: number
): { timestamp?: string; gps?: { lat: number; lon: number } } {
  const result: { timestamp?: string; gps?: { lat: number; lon: number } } = {}
  const header = read(0, 8)
  if (!header || header.byteLength < 8) return result

  let tiffOffset = 0
  if (header.getUint16(0) === 0xffd8) {
    let pos = 2
    let found = false
    const maxMarkers = 64
    let markers = 0
    while (pos + 4 <= fileSize && markers < maxMarkers) {
      markers++
      const seg = read(pos, 4)
      if (!seg || seg.getUint8(0) !== 0xff) break
      const marker = seg.getUint8(1)
      if (marker === 0xd9 || marker === 0xda) break
      const size = seg.getUint16(2)
      if (size < 2 || pos + 2 + size > fileSize) break
      if (marker === 0xe1 && size >= 16) {
        const id = read(pos + 4, 6)
        if (id && id.getUint32(0) === 0x45786966 && id.getUint16(4) === 0) {
          tiffOffset = pos + 10
          found = true
          break
        }
      }
      pos += 2 + size
    }
    if (!found) return result
  }

  const tiffHead = read(tiffOffset, 8)
  if (!tiffHead || tiffHead.byteLength < 8) return result
  const littleEndian = tiffByteOrder(tiffHead)
  if (littleEndian === undefined) return result

  const pending = [tiffHead.getUint32(4, littleEndian)]
  const visited = new Set<number>()
  while (pending.length && visited.size < 64) {
    const ifdOffset = pending.shift()!
    if (!ifdOffset || visited.has(ifdOffset) || tiffOffset + ifdOffset + 2 > fileSize) continue
    visited.add(ifdOffset)
    try {
      const countView = read(tiffOffset + ifdOffset, 2)
      if (!countView) continue
      const numEntries = countView.getUint16(0, littleEndian)
      if (numEntries > 4096 || tiffOffset + ifdOffset + 2 + numEntries * 12 > fileSize) continue

      const dirView = read(tiffOffset + ifdOffset + 2, numEntries * 12)
      if (!dirView) continue

      for (let i = 0; i < numEntries; i++) {
        const entryOffset = i * 12
        const tag = dirView.getUint16(entryOffset, littleEndian)
        const type = dirView.getUint16(entryOffset + 2, littleEndian)
        const count = dirView.getUint32(entryOffset + 4, littleEndian)
        const valueOffset = dirView.getUint32(entryOffset + 8, littleEndian)

        if ((tag === 0x0132 || tag === 0x9003) && type === 2 && count >= 19
          && (tag === 0x9003 || !result.timestamp)) {
          const strView = count <= 4
            ? new DataView(dirView.buffer, dirView.byteOffset + entryOffset + 8, count)
            : read(tiffOffset + valueOffset, Math.min(count, 19))
          if (strView) {
            let dateStr = ''
            for (let j = 0; j < 19; j++) {
              const char = strView.getUint8(j)
              if (char === 0) break
              dateStr += String.fromCharCode(char)
            }
            if (dateStr) result.timestamp = dateStr.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
          }
        }
        if (tag === 0x8769 && (type === 4 || type === 13) && count === 1) pending.push(valueOffset)
        if (tag === 0x8825 && (type === 4 || type === 13) && count === 1) {
          const gps = parseGPSSync(read, tiffOffset, valueOffset, littleEndian, fileSize)
          if (gps) result.gps = gps
        }
      }
    } catch (error) {
      if (!(error instanceof RangeError) && !(error instanceof TypeError)) {
        throw error
      }
      // Truncated optional metadata must not prevent importing the image.
    }
  }
  return result
}

function parseGPSSync(
  read: (offset: number, length: number) => DataView | undefined,
  tiffOffset: number,
  gpsIfdOffset: number,
  littleEndian: boolean,
  fileSize: number
): { lat: number; lon: number } | null {
  try {
    if (tiffOffset + gpsIfdOffset + 2 > fileSize) return null
    const countView = read(tiffOffset + gpsIfdOffset, 2)
    if (!countView) return null
    const numEntries = countView.getUint16(0, littleEndian)
    if (numEntries > 4096 || tiffOffset + gpsIfdOffset + 2 + numEntries * 12 > fileSize) return null

    const dirView = read(tiffOffset + gpsIfdOffset + 2, numEntries * 12)
    if (!dirView) return null

    let lat = 0, lon = 0, latRef = '', lonRef = ''
    for (let i = 0; i < numEntries; i++) {
      const entryOffset = i * 12
      const tag = dirView.getUint16(entryOffset, littleEndian)
      const type = dirView.getUint16(entryOffset + 2, littleEndian)
      const count = dirView.getUint32(entryOffset + 4, littleEndian)
      const rawOffset = dirView.getUint32(entryOffset + 8, littleEndian)

      if (tag === 1) {
        latRef = String.fromCharCode(dirView.getUint8(entryOffset + 8))
      } else if (tag === 3) {
        lonRef = String.fromCharCode(dirView.getUint8(entryOffset + 8))
      } else if (tag === 2 || tag === 4) {
        const typeSize: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 }
        const totalBytes = (typeSize[type] || 1) * count
        const isInline = totalBytes <= 4
        const valView = isInline
          ? new DataView(dirView.buffer, dirView.byteOffset + entryOffset + 8, totalBytes)
          : read(tiffOffset + rawOffset, 24)
        if (valView && valView.byteLength >= 24) {
          const d = valView.getUint32(0, littleEndian) / valView.getUint32(4, littleEndian)
          const m = valView.getUint32(8, littleEndian) / valView.getUint32(12, littleEndian)
          const s = valView.getUint32(16, littleEndian) / valView.getUint32(20, littleEndian)
          const val = d + m / 60 + s / 3600
          if (tag === 2) lat = val
          else lon = val
        }
      }
    }

    if (lat && lon) {
      return {
        lat: latRef === 'S' ? -lat : lat,
        lon: lonRef === 'W' ? -lon : lon,
      }
    }
  } catch (error) {
    if (!(error instanceof RangeError) && !(error instanceof TypeError)) {
      throw error
    }
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
