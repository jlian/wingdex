const MAX_IFDS = 64
const MAX_ENTRIES = 4096

export function tiffByteOrder(view: DataView, offset = 0): boolean | undefined {
  if (offset < 0 || offset + 8 > view.byteLength) return undefined
  const order = view.getUint16(offset)
  if (order !== 0x4949 && order !== 0x4d4d) return undefined
  const littleEndian = order === 0x4949
  return view.getUint16(offset + 2, littleEndian) === 42 ? littleEndian : undefined
}

/**
 * Read embedded JPEG previews from classic TIFF directories, independent of
 * camera brand or extension. This is not a RAW sensor decoder.
 * Never scan sensor bytes for JPEG markers: a RAW can contain several tiny
 * thumbnails as well as a full-size preview, at offsets beyond its EXIF header.
 */
export async function* embeddedJpegPreviews(file: Blob): AsyncGenerator<Blob> {
  const read = async (offset: number, length: number) => {
    if (offset < 0 || length < 0 || offset + length > file.size) return undefined
    return new DataView(await file.slice(offset, offset + length).arrayBuffer())
  }
  const header = await read(0, 8)
  if (!header) return
  const littleEndian = tiffByteOrder(header)
  if (littleEndian === undefined) return

  const pending = [header.getUint32(4, littleEndian)]
  const visited = new Set<number>()
  const previews: { offset: number; length: number; orientation?: number }[] = []
  let originalOrientation = 1
  while (pending.length && visited.size < MAX_IFDS) {
    const offset = pending.shift()!
    if (!offset || visited.has(offset)) continue
    visited.add(offset)
    const countView = await read(offset, 2)
    if (!countView) continue
    const count = countView.getUint16(0, littleEndian)
    if (count > MAX_ENTRIES) continue
    const directory = await read(offset + 2, count * 12 + 4)
    if (!directory) continue
    let jpegOffset = 0
    let jpegLength = 0
    let compression = 0
    let photometric = 0
    let stripOffset = 0
    let stripLength = 0
    let orientation: number | undefined
    for (let i = 0; i < count; i++) {
      const entry = i * 12
      const tag = directory.getUint16(entry, littleEndian)
      const type = directory.getUint16(entry + 2, littleEndian)
      const size = directory.getUint32(entry + 4, littleEndian)
      if (tag === 0x0112 && type === 3 && size === 1) {
        const value = directory.getUint16(entry + 8, littleEndian)
        if (value >= 1 && value <= 8) orientation = value
      }
      if (size === 1 && (type === 3 || type === 4)) {
        const value = type === 3
          ? directory.getUint16(entry + 8, littleEndian)
          : directory.getUint32(entry + 8, littleEndian)
        if (tag === 0x0103) compression = value
        if (tag === 0x0106) photometric = value
        if (tag === 0x0111) stripOffset = value
        if (tag === 0x0117) stripLength = value
      }
      if ((type !== 4 && type !== 13) || !size) continue
      const value = directory.getUint32(entry + 8, littleEndian)
      if (tag === 0x0201 && size === 1) jpegOffset = value
      if (tag === 0x0202 && size === 1) jpegLength = value
      if (tag === 0x014a && size <= MAX_IFDS) {
        const children = size === 1 ? undefined : await read(value, size * 4)
        if (size === 1) pending.push(value)
        else if (children) {
          for (let j = 0; j < size; j++) pending.push(children.getUint32(j * 4, littleEndian))
        }
      }
    }
    pending.push(directory.getUint32(count * 12, littleEndian))
    if (offset === header.getUint32(4, littleEndian)) originalOrientation = orientation ?? 1
    // Some TIFF-based RAWs store a rendered RGB/YCbCr preview as one JPEG
    // strip. Exclude CFA/linear RAW sensor data and multi-strip images, which
    // cannot be treated as a standalone rendered JPEG.
    if (!jpegOffset && (compression === 6 || compression === 7)
      && (photometric === 2 || photometric === 6)) {
      jpegOffset = stripOffset
      jpegLength = stripLength
    }
    if (jpegOffset > 0 && jpegLength >= 4 && jpegOffset + jpegLength <= file.size) {
      previews.push({ offset: jpegOffset, length: jpegLength, orientation })
    }
  }

  // Prefer the full rendered image over the camera's tiny EXIF thumbnail.
  previews.sort((a, b) => b.length - a.length)
  const emitted = new Set<string>()
  for (const { offset, length, orientation } of previews) {
    const key = `${offset}:${length}`
    if (emitted.has(key)) continue
    emitted.add(key)
    const start = await read(offset, 2)
    if (start?.getUint16(0) !== 0xffd8) continue
    yield await orientPreview(file.slice(offset, offset + length, 'image/jpeg'), orientation ?? originalOrientation)
  }
}

async function orientPreview(jpeg: Blob, orientation: number): Promise<Blob> {
  if (orientation === 1) return jpeg
  const head = new DataView(await jpeg.slice(0, 65536).arrayBuffer())
  let offset = 2
  while (offset + 4 <= head.byteLength) {
    const marker = head.getUint16(offset)
    const size = head.getUint16(offset + 2)
    if (marker === 0xffda || size < 2 || offset + 2 + size > head.byteLength) break
    if (marker === 0xffe1 && size >= 16 && head.getUint32(offset + 4) === 0x45786966) {
      const tiff = offset + 10
      const little = tiffByteOrder(head, tiff)
      if (little !== undefined) {
        const ifd = tiff + head.getUint32(tiff + 4, little)
        if (ifd + 2 <= head.byteLength) {
          const count = head.getUint16(ifd, little)
          for (let i = 0; i < count && ifd + 2 + (i + 1) * 12 <= head.byteLength; i++) {
            if (head.getUint16(ifd + 2 + i * 12, little) === 0x0112) return jpeg
          }
        }
      }
    }
    offset += 2 + size
  }
  // Camera previews may omit EXIF entirely. Supply the TIFF's orientation so
  // the browser applies it consistently to thumbnails, crops and inference.
  const exif = new Uint8Array([
    0xff, 0xe1, 0, 34, 69, 120, 105, 102, 0, 0,
    73, 73, 42, 0, 8, 0, 0, 0, 1, 0,
    0x12, 1, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0,
  ])
  return new Blob([jpeg.slice(0, 2), exif, jpeg.slice(2)], { type: 'image/jpeg' })
}
