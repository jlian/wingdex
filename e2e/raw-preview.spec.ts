import { test, expect } from '@playwright/test'

test.describe('embedded JPEG preview import', () => {
  for (const fixtureCase of [
    { extension: 'ARW', layout: 'reference', orientation: 1, littleEndian: true },
    { extension: 'NEF', layout: 'reference', orientation: 6, littleEndian: false },
    { extension: 'DNG', layout: 'strip', orientation: 6, littleEndian: true },
  ]) {
    const { extension, layout, orientation } = fixtureCase
    test(`imports a TIFF JPEG ${layout} named .${extension} with orientation ${orientation}`, async ({ page }) => {
      await page.goto('/')
      const fixture = await page.evaluate(async ({ extension, layout, orientation, littleEndian }) => {
        const makeJpeg = async (width: number, height: number) => {
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')!
          ctx.fillStyle = '#28a040'
          ctx.fillRect(0, 0, width, height)
          const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/jpeg'))
          return new Uint8Array(await blob.arrayBuffer())
        }
        const tiny = await makeJpeg(16, 12)
        const full = await makeJpeg(640, 480)
        const bytes = new Uint8Array(200_000 + full.length)
        const view = new DataView(bytes.buffer)
        view.setUint16(0, littleEndian ? 0x4949 : 0x4d4d)
        view.setUint16(2, 42, littleEndian)
        view.setUint32(4, 8, littleEndian)
        const directory = (offset: number, jpegOffset: number, jpegLength: number, next = 0) => {
          const entries = layout === 'strip'
            ? [[0x112, 3, orientation], [0x103, 3, 7], [0x106, 3, 6], [0x111, 4, jpegOffset], [0x117, 4, jpegLength]]
            : [[0x112, 3, orientation], [0x201, 4, jpegOffset], [0x202, 4, jpegLength]]
          view.setUint16(offset, entries.length, littleEndian)
          entries.forEach(([tag, type, value], index) => {
            const entry = offset + 2 + index * 12
            view.setUint16(entry, tag, littleEndian)
            view.setUint16(entry + 2, type, littleEndian)
            view.setUint32(entry + 4, 1, littleEndian)
            if (type === 3) view.setUint16(entry + 8, value, littleEndian)
            else view.setUint32(entry + 8, value, littleEndian)
          })
          view.setUint32(offset + 2 + entries.length * 12, next, littleEndian)
        }
        directory(8, 500, tiny.length, 140_000)
        directory(140_000, 200_000, full.length)
        bytes.set(tiny, 500)
        bytes.set(full, 200_000)
        const file = new File([bytes], `synthetic.${extension}`)
        const modulePath = '/src/lib/photo-utils.ts'
        const { preparePhotoImage, generateThumbnail } = await import(/* @vite-ignore */ modulePath)
        let nativeFailed = false
        try { await generateThumbnail(file) } catch { nativeFailed = true }
        const prepared = await preparePhotoImage(file)
        const bitmap = await createImageBitmap(prepared.image)
        const width = bitmap.width
        const height = bitmap.height
        bitmap.close()
        const base64 = await new Promise<string>(resolve => {
          const reader = new FileReader()
          reader.onload = () => resolve((reader.result as string).split(',')[1])
          reader.readAsDataURL(file)
        })
        return { base64, width, height, nativeFailed, imageType: prepared.image.type }
      }, fixtureCase)

      expect(fixture.nativeFailed).toBe(true)
      expect(fixture.imageType).toBe('image/jpeg')
      expect([fixture.width, fixture.height]).toEqual(orientation === 6 ? [480, 640] : [640, 480])
      await page.getByRole('button', { name: 'Upload & Identify', exact: true }).click()
      await expect(page.locator('input[type="file"]')).toHaveAttribute('accept', new RegExp(`\\.${extension.toLowerCase()}`))
      await page.locator('input[type="file"]').setInputFiles({
        name: `synthetic.${extension}`,
        mimeType: '',
        buffer: Buffer.from(fixture.base64, 'base64'),
      })
      await expect(page.getByText('Photos (1)', { exact: true })).toBeVisible()
      const image = page.getByRole('img', { name: 'Bird', exact: true })
      await expect(image).toBeVisible()
      expect(await image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
    })
  }

  test('explains an unsupported image and allows another selection', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Upload & Identify', exact: true }).click()
    await page.locator('input[type="file"]').setInputFiles({
      name: 'unsupported.raw',
      mimeType: '',
      buffer: Buffer.from('not a supported image container'),
    })
    await expect(page.getByText(/unsupported\.raw:.*Export a JPEG copy/)).toBeVisible()
    await expect(page.locator('input[type="file"]')).toBeAttached()
    await expect(page.getByText('No photos to process', { exact: true })).toHaveCount(0)
  })
})
