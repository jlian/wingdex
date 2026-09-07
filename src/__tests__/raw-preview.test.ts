import { File as NodeFile } from 'node:buffer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { embeddedJpegPreviews } from '@/lib/raw-preview'
import { generateThumbnail, parseEXIF, preparePhotoImage, PhotoDecodeError } from '@/lib/photo-utils'

function rawFixture(littleEndian = true) {
  const bytes = new Uint8Array(200_100)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, littleEndian ? 0x4949 : 0x4d4d)
  view.setUint16(2, 42, littleEndian)
  view.setUint32(4, 8, littleEndian)
  const directory = (offset: number, entries: number[][], next = 0) => {
    view.setUint16(offset, entries.length, littleEndian)
    entries.forEach(([tag, type, count, value], index) => {
      const entry = offset + 2 + index * 12
      view.setUint16(entry, tag, littleEndian)
      view.setUint16(entry + 2, type, littleEndian)
      view.setUint32(entry + 4, count, littleEndian)
      if (type === 3 && count === 1) view.setUint16(entry + 8, value, littleEndian)
      else view.setUint32(entry + 8, value, littleEndian)
    })
    view.setUint32(offset + 2 + entries.length * 12, next, littleEndian)
  }
  directory(8, [[0x132, 2, 20, 400], [0x8769, 4, 1, 100], [0x14a, 4, 1, 200]], 300)
  directory(100, [[0x9003, 2, 20, 420]])
  directory(200, [[0x201, 4, 1, 200_000], [0x202, 4, 1, 100]])
  directory(300, [[0x201, 4, 1, 500], [0x202, 4, 1, 10]], 8)
  bytes.set(new TextEncoder().encode('2026:08:02 12:00:00\0'), 400)
  bytes.set(new TextEncoder().encode('2026:08:01 12:00:00\0'), 420)
  bytes.set([0xff, 0xd8, 0xff, 0xd9], 500)
  bytes.set([0xff, 0xd8, 0xff, 0xd9], 200_000)
  return { bytes, view, directory }
}

function fileFrom(bytes: Uint8Array, name = 'camera.ARW'): File {
  return new NodeFile([bytes], name, { type: '' }) as unknown as File
}

async function previews(file: File) {
  const result: Blob[] = []
  for await (const preview of embeddedJpegPreviews(file)) result.push(preview)
  return result
}

describe('RAW TIFF metadata and rendered previews', () => {
  it.each([true, false])('reads linked/SubIFD JPEGs outside the EXIF prefix, endian=%s', async little => {
    const { bytes } = rawFixture(little)
    const images = await previews(fileFrom(bytes))
    expect(images.map(image => image.size)).toEqual([100, 10])
    expect(images.every(image => image.type === 'image/jpeg')).toBe(true)
    expect(parseEXIF(new DataView(bytes.buffer))).toEqual({ timestamp: '2026-08-01 12:00:00' })
  })

  it('reads SubIFD arrays and ignores cyclic links', async () => {
    const { bytes, view, directory } = rawFixture()
    directory(8, [[0x14a, 4, 2, 600]])
    view.setUint32(600, 200, true)
    view.setUint32(604, 300, true)
    expect((await previews(fileFrom(bytes))).map(image => image.size)).toEqual([100, 10])
  })

  it('ranks candidate previews by pixel area over compressed byte size', async () => {
    const { bytes, directory } = rawFixture()
    const thumb = new Uint8Array(2000)
    thumb.set([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08,
      0x00, 0x78, 0x00, 0xa0, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    ])
    thumb[1998] = 0xff; thumb[1999] = 0xd9
    const full = new Uint8Array(1000)
    full.set([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08,
      0x07, 0xd0, 0x0b, 0xb8, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    ])
    full[998] = 0xff; full[999] = 0xd9
    bytes.set(thumb, 500)
    bytes.set(full, 100_000)
    directory(200, [[0x201, 4, 1, 100_000], [0x202, 4, 1, 1000]])
    directory(300, [[0x201, 4, 1, 500], [0x202, 4, 1, 2000]])
    const images = await previews(fileFrom(bytes))
    expect(images.map(image => image.size)).toEqual([1000, 2000])
  })

  it.each([true, false])('reads a self-contained JPEG preview strip, endian=%s', async little => {
    const { bytes, directory } = rawFixture(little)
    directory(8, [[0x14a, 13, 1, 200]])
    directory(200, [
      [0x103, 3, 1, 7], [0x106, 3, 1, 6],
      [0x111, 4, 1, 200_000], [0x117, 3, 1, 100],
    ])
    expect((await previews(fileFrom(bytes))).map(image => image.size)).toEqual([100])
  })

  it.each([
    [7, 32803, 1], // CFA sensor data, not a rendered preview.
    [7, 34892, 1], // Linear RAW sensor data.
    [1, 2, 1], // Uncompressed RGB, not JPEG.
    [7, 6, 2], // Separate strips cannot be treated as one JPEG.
  ])('rejects non-preview strips (compression=%s, photometric=%s, count=%s)', async (compression, photometric, count) => {
    const { bytes, directory } = rawFixture()
    directory(8, [[0x14a, 4, 1, 200]])
    directory(200, [
      [0x103, 3, 1, compression], [0x106, 3, 1, photometric],
      [0x111, 4, count, 200_000], [0x117, 4, count, 100],
    ])
    expect(await previews(fileFrom(bytes))).toEqual([])
  })

  it('does not repeatedly decode the same preview referenced by several directories', async () => {
    const { bytes, directory } = rawFixture()
    directory(300, [[0x201, 4, 1, 200_000], [0x202, 4, 1, 100]])
    expect((await previews(fileFrom(bytes))).map(image => image.size)).toEqual([100])
  })

  it('reads original RAW GPS independently of the rendered preview', () => {
    const { bytes, view, directory } = rawFixture()
    directory(8, [[0x8825, 4, 1, 700]])
    directory(700, [[1, 2, 2, 83], [2, 5, 3, 800], [3, 2, 2, 87], [4, 5, 3, 824]])
    for (const [offset, degrees] of [[800, 30], [824, 60]]) {
      for (let i = 0; i < 3; i++) {
        view.setUint32(offset + i * 8, i === 0 ? degrees : 0, true)
        view.setUint32(offset + i * 8 + 4, 1, true)
      }
    }
    expect(parseEXIF(new DataView(bytes.buffer)).gps).toEqual({ lat: -30, lon: -60 })
  })

  it('rejects out-of-file JPEG ranges and non-JPEG sensor data', async () => {
    const { bytes, directory } = rawFixture()
    directory(200, [[0x201, 4, 1, 200_000], [0x202, 4, 1, 0xffffffff]])
    bytes[500] = 0
    expect(await previews(fileFrom(bytes))).toEqual([])
  })

  it('bounds malformed directory counts and tolerates truncated metadata', async () => {
    const { bytes, view } = rawFixture()
    view.setUint16(8, 65535, true)
    expect(await previews(fileFrom(bytes))).toEqual([])
    expect(parseEXIF(view)).toEqual({})
    for (const length of [0, 1, 7, 10, 20]) {
      expect(() => parseEXIF(new DataView(bytes.buffer, 0, length))).not.toThrow()
    }
  })

  it('skips unrelated APP1 segments before JPEG EXIF', () => {
    const { bytes } = rawFixture()
    const jpeg = new Uint8Array(1016)
    jpeg.set([0xff, 0xd8, 0xff, 0xe1, 0, 2, 0xff, 0xe1, 3, 0xf0, 69, 120, 105, 102, 0, 0])
    jpeg.set(bytes.subarray(0, 1000), 16)
    expect(parseEXIF(new DataView(jpeg.buffer)).timestamp).toBe('2026-08-01 12:00:00')
  })
})

describe('native-first photo preparation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function mockDecoder(canDecode: (blob: Blob) => boolean) {
    const blobs = new Map<string, Blob>()
    const attempted: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
      const url = `blob:${blobs.size}`
      blobs.set(url, blob as Blob)
      return url
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.stubGlobal('Image', class {
      width = 1200
      height = 800
      onload?: () => void
      onerror?: () => void
      set src(url: string) {
        const blob = blobs.get(url)!
        attempted.push(blob)
        queueMicrotask(() => canDecode(blob) ? this.onload?.() : this.onerror?.())
      }
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,thumbnail')
    return attempted
  }

  it.each(['image/jpeg', 'image/heic', 'image/heif'])('keeps browser-decodable %s originals', async type => {
    const attempts = mockDecoder(() => true)
    // This asserts decoder routing, not actual HEIF codec support in jsdom.
    const file = new NodeFile(['native image'], 'bird', { type }) as unknown as File
    const read = vi.spyOn(file, 'slice')
    const result = await preparePhotoImage(file)
    expect(result.image).toBe(file)
    expect(read).not.toHaveBeenCalled()
    expect(attempts).toEqual([file])
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it.each(['camera.ARW', 'camera.NEF', 'camera.CR2', 'camera.DNG', 'camera.PEF', 'camera.SRW', 'unknown-format'])(
    'uses TIFF structure rather than the name or MIME type (%s)', async name => {
      const attempts = mockDecoder(blob => blob.type === 'image/jpeg')
      const original = fileFrom(rawFixture().bytes, name)
      const result = await preparePhotoImage(original)
      expect(result.image.type).toBe('image/jpeg')
      expect(result.image.size).toBe(100)
      expect(attempts.map(blob => blob.size)).toEqual([original.size, 100])
      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
    },
  )

  it('tries a smaller preview if the larger JPEG is damaged', async () => {
    mockDecoder(blob => blob.size === 10)
    expect((await preparePhotoImage(fileFrom(rawFixture().bytes))).image.size).toBe(10)
  })

  it('rejects unsupported files with an actionable error and releases URLs', async () => {
    mockDecoder(() => false)
    await expect(preparePhotoImage(fileFrom(new Uint8Array(8)))).rejects.toThrow(PhotoDecodeError)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it.each(['camera.CR3', 'camera.RAF', 'camera.heic', 'camera.DNG'])('rejects an unsupported container without guessing from %s', async name => {
    mockDecoder(() => false)
    const file = fileFrom(new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112]), name)
    await expect(preparePhotoImage(file)).rejects.toThrow('Export a JPEG copy')
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  })

  it('propagates file read failures rather than misreporting an unsupported format', async () => {
    mockDecoder(() => false)
    const file = fileFrom(rawFixture().bytes)
    vi.spyOn(file, 'slice').mockImplementation(() => { throw new Error('File is no longer readable') })
    await expect(preparePhotoImage(file)).rejects.toThrow('File is no longer readable')
  })

  it('releases a decoded URL and does not try previews when canvas processing fails', async () => {
    mockDecoder(() => true)
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null)
    await expect(generateThumbnail(new Blob())).rejects.toThrow('Canvas not supported')
    const file = fileFrom(rawFixture().bytes)
    const read = vi.spyOn(file, 'slice')
    await expect(preparePhotoImage(file)).rejects.toThrow('Canvas not supported')
    expect(read).not.toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
  })
})
