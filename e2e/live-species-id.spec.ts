import { test, expect } from '@playwright/test'
import path from 'path'
import { loadApp } from './helpers'

const isCI = !!process.env.CI

test.describe('Live Species ID', () => {
  // Locally the wrangler dev server has OPENAI_API_KEY via .dev.vars,
  // so always run. In CI, skip unless explicitly opted in.
  test.skip(isCI && process.env.RUN_LIVE_E2E !== '1', 'Skipped in CI - set RUN_LIVE_E2E=1 to run')

  test('hits live /api/identify-bird and reaches species step', async ({ page }) => {
    await loadApp(page)

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
