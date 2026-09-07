import { test, expect } from './fixtures'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { loadApp } from './helpers'

test('a mobile visitor can browse, open uploads and legal pages, but not Settings', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await loadApp(page, { promote: false })
  await expect(page.locator('header').getByText('WingDex')).toBeVisible()
  expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(375)

  await page.getByRole('tab', { name: 'Outings' }).first().click()
  await expect(page.getByText('No outings yet')).toBeVisible()
  await page.getByRole('tab', { name: 'WingDex' }).first().click()
  await expect(page.getByText('Your WingDex is empty')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Settings' })).toBeHidden()
  await page.goto('/#settings')
  await expect(page.getByRole('button', { name: 'Upload & Identify' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeHidden()

  await page.getByRole('button', { name: 'Upload & Identify' }).click()
  await expect(page.getByRole('button', { name: 'Select Photos' })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()

  const footer = page.locator('footer')
  await expect(footer.getByRole('link', { name: 'Privacy', exact: true })).toHaveAttribute('href', '/#privacy')
  await expect(footer.getByRole('link', { name: 'Terms', exact: true })).toHaveAttribute('href', '/#terms')
  await footer.getByRole('link', { name: 'Privacy', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible()
  await footer.getByRole('link', { name: 'Terms', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Terms of Use' })).toBeVisible()
  await page.getByRole('link', { name: 'Privacy Policy' }).click()
  await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible()
  expect(errors).toEqual([])
})

test('serves the occurrence prior as raw gzip bytes', async ({ request }) => {
  const response = await request.get('/priors/occurrence.d0abc168.bin.gz', {
    headers: { Range: 'bytes=0-1' },
  })
  expect([200, 206]).toContain(response.status())
  expect(response.headers()['content-encoding']).toBeUndefined()
  expect(Array.from((await response.body()).subarray(0, 2))).toEqual([0x1f, 0x8b])
})

test('multiple photo selection reaches review and supports keeping or discarding progress', async ({ page }) => {
  await loadApp(page, { promote: false })
  await page.getByRole('button', { name: 'Upload & Identify' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('input[type="file"]').setInputFiles([
    path.resolve('src/assets/images/Common_kingfisher_at_Taipei_Zoo.jpeg'),
    path.resolve('src/assets/images/Stellers_Jay_eating_cherries_Seattle_backyard.jpg'),
  ])
  await expect(dialog.getByText('Review Outing')).toBeVisible()
  await expect(dialog.getByRole('button', { name: /continue to species/i })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByText('Discard progress?')).toBeVisible()
  await page.getByRole('button', { name: 'Continue uploading' }).click()
  await expect(page.getByText('Discard progress?')).toBeHidden()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(page.getByText('Discard progress?')).toBeHidden()
  await expect(dialog).toBeHidden()
})

test('drag-and-drop reaches photo review', async ({ page }) => {
  await loadApp(page, { promote: false })
  await page.getByRole('button', { name: 'Upload & Identify' }).click()
  const imagePath = path.resolve('src/assets/images/Common_kingfisher_at_Taipei_Zoo.jpeg')
  const dataTransfer = await page.evaluateHandle(({ bytesBase64, fileName }) => {
    const bytes = Uint8Array.from(atob(bytesBase64), char => char.charCodeAt(0))
    const transfer = new DataTransfer()
    transfer.items.add(new File([bytes], fileName, { type: 'image/jpeg' }))
    return transfer
  }, { bytesBase64: readFileSync(imagePath).toString('base64'), fileName: path.basename(imagePath) })
  await page.getByRole('button', { name: 'Select Photos' }).dispatchEvent('drop', { dataTransfer })
  await expect(page.getByText('Review Outing')).toBeVisible()
})
