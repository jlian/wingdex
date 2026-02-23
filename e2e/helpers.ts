import { expect, type Page } from '@playwright/test'
import path from 'path'

/**
 * Navigate to the app and wait for it to load.
 * Optionally promotes the anonymous session so auth-gated features
 * (Settings, imports, uploads) are accessible in CI / Wrangler environments.
 */
export async function loadApp(page: Page, { promote = true } = {}) {
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
  } catch (error) {
    const message = String(error)
    if (!message.includes('frame was detached') && !message.includes('ERR_ABORTED')) {
      throw error
    }
    await page.goto('/', { waitUntil: 'domcontentloaded' })
  }
  await expect(page.locator('header')).toBeVisible({ timeout: 10_000 })

  if (promote) {
    await promoteAnonymousUser(page)
  }
}

/**
 * Promote the anonymous session to a real user so auth-gated features
 * (Settings, imports, uploads) are accessible.
 *
 * In CI (Wrangler), the app auto-creates an anonymous session.
 * This calls finalize-passkey to flip isAnonymous → false, then reloads.
 * In local dev without Wrangler the fallback user is already non-anonymous,
 * so this is a silent no-op.
 */
export async function promoteAnonymousUser(page: Page) {
  const promoted = await page.evaluate(async () => {
    try {
      const res = await fetch('/api/auth/finalize-passkey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'e2e-test-user' }),
      })
      return res.ok
    } catch {
      return false
    }
  })

  if (promoted) {
    await page.reload()
    await expect(page.locator('header')).toBeVisible({ timeout: 10_000 })
  }
}

/**
 * Seed the app with data from the eBird CSV fixture via the import API.
 *
 * Navigates to Settings, uploads the CSV through the hidden file input
 * (which triggers preview → auto-confirm), waits for the success toast,
 * then navigates back to the Home tab.
 */
export async function seedViaCSVImport(page: Page) {
  await loadApp(page)

  // Open Settings
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 5_000 })

  // Set the hidden CSV file input directly (bypasses the timezone dialog;
  // default timezone is America/Los_Angeles which matches the fixture)
  const csvInput = page.locator('input[type="file"][accept*=".csv"]')
  await csvInput.setInputFiles(path.resolve('e2e/fixtures/ebird-import.csv'))

  // Wait for the import to fully complete
  await expect(page.getByText(/Imported.*species/i)).toBeVisible({ timeout: 15_000 })

  // Navigate back to Home
  await page.getByRole('button', { name: 'Home' }).click()
  await expect(page.locator('header')).toBeVisible({ timeout: 5_000 })
}
