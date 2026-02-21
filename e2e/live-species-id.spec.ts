import { test, expect } from '@playwright/test'
import path from 'path'

test.describe('Live Species ID', () => {
  test('hits live /api/identify-bird and reaches species step', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('header')).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: 'Upload & Identify' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5_000 })

    const fileInput = dialog.locator('input[type="file"]')
    await fileInput.setInputFiles(path.resolve('src/assets/images/Common_kingfisher_at_Taipei_Zoo.jpeg'))

    await expect(dialog.getByText('Review Outing')).toBeVisible({ timeout: 20_000 })

    const identifyResponsePromise = page.waitForResponse(
      response => response.url().includes('/api/identify-bird') && response.request().method() === 'POST',
      { timeout: 60_000 }
    )

    await dialog.getByRole('button', { name: /Continue to Species/i }).click()

    const identifyResponse = await identifyResponsePromise
    const responseText = await identifyResponse.text()
    expect(identifyResponse.ok(), `identify API failed (${identifyResponse.status()}): ${responseText.slice(0, 400)}`).toBe(true)

    await expect(
      dialog.getByRole('button', { name: 'Confirm' })
        .or(dialog.getByText(/Multiple bird species detected/i))
        .or(dialog.getByText(/No species identified/i))
    ).toBeVisible({ timeout: 20_000 })
  })
})
