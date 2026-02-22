import { expect, type Page } from '@playwright/test'
import path from 'path'

/**
 * Seed the app with data from the eBird CSV fixture via the import API.
 *
 * Navigates to Settings, uploads the CSV through the hidden file input
 * (which triggers preview → auto-confirm), waits for the success toast,
 * then navigates back to the Home tab.
 */
export async function seedViaCSVImport(page: Page) {
  await page.goto('/')
  await expect(page.locator('header')).toBeVisible({ timeout: 10_000 })

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
