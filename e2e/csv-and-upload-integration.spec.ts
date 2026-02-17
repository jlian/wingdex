import { test, expect, type Page, type Route } from '@playwright/test'
import path from 'path'
import { readFileSync } from 'fs'

// ── Fixture helpers ──────────────────────────────────────────────

const FIXTURES_DIR = path.resolve('src/__tests__/fixtures/llm-responses')

function loadLLMFixture(name: string) {
  const data = JSON.parse(readFileSync(path.join(FIXTURES_DIR, `${name}.json`), 'utf8'))
  return {
    choices: [{ message: { content: data.rawResponse } }],
  }
}

/** Mock the /_spark/llm endpoint with a fixture-based response. */
function mockLLM(page: Page, fixtureName: string) {
  return page.route('**/_spark/llm', (route: Route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(loadLLMFixture(fixtureName)),
    })
  })
}

/** Mock Nominatim geocoding to return a canned location name. */
function mockNominatim(page: Page, locationName: string) {
  return page.route('**/nominatim.openstreetmap.org/**', (route: Route) => {
    const url = new URL(route.request().url())
    if (url.pathname.includes('reverse')) {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          display_name: locationName,
          address: {
            leisure: locationName.split(',')[0],
            city: locationName.split(',').pop()?.trim() || '',
          },
        }),
      })
    } else {
      // search endpoint — return a park-like result
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            display_name: locationName,
            lat: '47.66',
            lon: '-122.41',
            class: 'leisure',
            type: 'park',
          },
        ]),
      })
    }
  })
}

/** Mock Wikipedia/Wikimedia image requests so they don't fail. */
function mockWikimedia(page: Page) {
  return page.route('**/en.wikipedia.org/**', (route: Route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"query":{"pages":{}}}' })
  })
}

/** Navigate to app, wait for it to load. */
async function loadApp(page: Page) {
  await page.goto('/')
  await expect(page.locator('header')).toBeVisible({ timeout: 10_000 })
}

/** Navigate to Settings page. */
async function goToSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 5_000 })
}

// ── Tests ────────────────────────────────────────────────────────

test.describe('CSV import + photo upload integration', () => {

  test('CSV import creates outings with correct timezone-converted times', async ({ page }) => {
    await loadApp(page)
    await goToSettings(page)

    // Profile timezone defaults to America/Los_Angeles (Pacific) — no need to change it

    // Import the test CSV
    const fileInput = page.locator('input[type="file"][accept*=".csv"]')
    await fileInput.setInputFiles(path.resolve('e2e/fixtures/ebird-import.csv'))

    // Wait for the success toast
    await expect(page.getByText(/Imported.*species.*outings/)).toBeVisible({ timeout: 10_000 })

    // Wait for the toast to dismiss so it doesn't intercept clicks
    await expect(page.getByText(/Imported.*species.*outings/)).not.toBeVisible({ timeout: 10_000 })

    // Navigate to Outings page
    await page.getByRole('tab', { name: 'Outings' }).first().click()
    await expect(page.getByText('Your Outings')).toBeVisible({ timeout: 5_000 })

    // Should have 2 outings (2 submission IDs in our CSV)
    // Haleakala outing
    await expect(
      page.locator('p:visible', { hasText: 'Haleakala' }).first()
    ).toBeVisible({ timeout: 5_000 })

    // Discovery Park outing
    await expect(
      page.locator('p:visible', { hasText: 'Discovery Park' }).first()
    ).toBeVisible()

    // Navigate to WingDex to verify species
    await page.getByRole('tab', { name: 'WingDex' }).first().click()
    await expect(page.locator('p:visible', { hasText: 'species observed' }).first()).toBeVisible({ timeout: 5_000 })
    const wingdexSearch = page.getByPlaceholder('Search species...')

    // All 4 species from the CSV should be in the dex
    for (const species of ['Chukar', 'Hawaiian Goose', "Steller's Jay", 'Dark-eyed Junco']) {
      await wingdexSearch.fill(species)
      await page.waitForTimeout(150)
      await expect(
        page.locator('p:visible', { hasText: species }).first()
      ).toBeVisible()
    }
  })

  test('full photo upload flow: upload → AI identify → confirm → saved to WingDex', async ({ page }) => {
    await mockLLM(page, 'Chukar_partridge_near_Haleakala_summit_Maui')
    await mockNominatim(page, 'Haleakala National Park, Maui')
    await mockWikimedia(page)

    await loadApp(page)

    // Open upload wizard
    await page.getByRole('button', { name: 'Upload & Identify' }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })

    // Upload a Chukar image (has EXIF GPS for Haleakala)
    const fileInput = page.getByRole('dialog').locator('input[type="file"]')
    await fileInput.setInputFiles(
      path.resolve('src/assets/images/Chukar_partridge_near_Haleakala_summit_Maui.jpg')
    )

    // Should reach Review Outing step
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Review Outing')).toBeVisible({ timeout: 15_000 })

    // Click continue to species identification
    await dialog.getByRole('button', { name: /Continue to Species/i }).click()

    // Wait for AI processing, then the confirm step (scope to dialog)
    await expect(dialog.getByText(/Chukar/)).toBeVisible({ timeout: 15_000 })

    // Confirm the species (high confidence = auto-selected with Confirm button)
    await dialog.getByRole('button', { name: 'Confirm' }).first().click()

    // Should show completion
    await expect(page.getByText(/All done|species saved/i)).toBeVisible({ timeout: 10_000 })

    // Wait for dialog to auto-close
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 })

    // Navigate to WingDex to verify the species was saved
    await page.getByRole('tab', { name: 'WingDex' }).first().click()
    await expect(page.locator('p:visible', { hasText: 'species observed' }).first()).toBeVisible({ timeout: 5_000 })
    await page.getByPlaceholder('Search species...').fill('chukar')
    await page.waitForTimeout(150)

    await expect(
      page.locator('p:visible', { hasText: 'Chukar' }).first()
    ).toBeVisible()
  })

  test('species convergence: CSV import + photo upload for same species increases count', async ({ page }) => {
    // First: import CSV that includes Chukar
    await loadApp(page)
    await goToSettings(page)

    // Set timezone and import CSV (default is already Pacific, no need to change)
    const csvInput = page.locator('input[type="file"][accept*=".csv"]')
    await csvInput.setInputFiles(path.resolve('e2e/fixtures/ebird-import.csv'))
    await expect(page.getByText(/Imported.*species/)).toBeVisible({ timeout: 10_000 })

    // Wait for the toast to dismiss
    await expect(page.getByText(/Imported.*species/)).not.toBeVisible({ timeout: 10_000 })

    // Verify Chukar is in the dex from CSV
    await page.getByRole('tab', { name: 'WingDex' }).first().click()
    await expect(page.locator('p:visible', { hasText: 'species observed' }).first()).toBeVisible({ timeout: 5_000 })
    await page.getByPlaceholder('Search species...').fill('chukar')
    await page.waitForTimeout(150)
    await expect(page.locator('p:visible', { hasText: 'Chukar' }).first()).toBeVisible()

    // Now upload a Chukar photo — the same species should converge
    await mockLLM(page, 'Chukar_partridge_near_Haleakala_summit_Maui')
    await mockNominatim(page, 'Haleakala National Park, Maui')
    await mockWikimedia(page)

    // Navigate home and open upload wizard
    await page.locator('header button').first().click()
    // After CSV import, home page shows "Add" button (not "Upload & Identify")
    await expect(page.getByRole('button', { name: 'Add' })).toBeVisible({ timeout: 5_000 })
    await page.getByRole('button', { name: 'Add' }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })

    const fileInput = page.getByRole('dialog').locator('input[type="file"]')
    await fileInput.setInputFiles(
      path.resolve('src/assets/images/Chukar_partridge_near_Haleakala_summit_Maui.jpg')
    )

    // Review outing → continue → confirm (scope to dialog)
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Review Outing')).toBeVisible({ timeout: 15_000 })
    await dialog.getByRole('button', { name: /Continue to Species/i }).click()
    await expect(dialog.getByText(/Chukar/)).toBeVisible({ timeout: 15_000 })
    await dialog.getByRole('button', { name: 'Confirm' }).first().click()

    // Dialog auto-closes after species save
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 15_000 })

    // Go to WingDex — Chukar should still be there (converged, not duplicated)
    await page.getByRole('tab', { name: 'WingDex' }).first().click()
    await expect(page.locator('p:visible', { hasText: 'species observed' }).first()).toBeVisible({ timeout: 5_000 })
    await page.getByPlaceholder('Search species...').fill('chukar')
    await page.waitForTimeout(150)

    // Count the Chukar entries — should be exactly 1 (not 2 separate entries)
    const chukarEntries = page.locator('p:visible', { hasText: /^Chukar/ })
    await expect(chukarEntries).toHaveCount(1)

    // Click into Chukar detail to verify the sighting count increased
    await chukarEntries.first().click()
    await page.waitForTimeout(1000)
    await expect(page.getByRole('heading', { name: 'Chukar' })).toBeVisible()

    // Should show 2 outings for this species (one from CSV, one from photo upload)
    await expect(page.getByText(/2.*outing/i)).toBeVisible({ timeout: 5_000 })
  })

  test('multi-photo clustering: photos from different locations create separate outings', async ({ page }) => {
    // Mock LLM to respond differently based on which call it is
    let callCount = 0
    await page.route('**/_spark/llm', (route: Route) => {
      callCount++
      // First call = Chukar (Haleakala), second call = Steller's Jay (Seattle)
      const fixture = callCount === 1
        ? loadLLMFixture('Chukar_partridge_near_Haleakala_summit_Maui')
        : loadLLMFixture('Stellers_Jay_eating_cherries_Seattle_backyard')
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixture),
      })
    })
    await mockNominatim(page, 'Discovery Park, Seattle')
    await mockWikimedia(page)

    await loadApp(page)

    // Open upload wizard
    await page.getByRole('button', { name: 'Upload & Identify' }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })

    // Upload two photos from very different locations:
    // Chukar from Haleakala, Hawaii (lat 20.7, lon -156.1)
    // Steller's Jay from Seattle, WA (lat 47.6, lon -122.4)
    // These should cluster into 2 separate outings (>6km apart)
    const fileInput = page.getByRole('dialog').locator('input[type="file"]')
    await fileInput.setInputFiles([
      path.resolve('src/assets/images/Chukar_partridge_near_Haleakala_summit_Maui.jpg'),
      path.resolve('src/assets/images/Stellers_Jay_eating_cherries_Seattle_backyard.jpg'),
    ])

    // Should reach Review Outing step for the first cluster
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Review Outing')).toBeVisible({ timeout: 15_000 })

    // The wizard should indicate multiple clusters (e.g., "Review Outing 1 of 2")
    await expect(dialog.getByRole('heading', { name: /Review Outing 1 of 2/i })).toBeVisible({ timeout: 5_000 })

    // Confirm first outing → identify species → confirm
    await dialog.getByRole('button', { name: /Continue to Species/i }).click()
    await expect(dialog.getByText(/Chukar|Jay/)).toBeVisible({ timeout: 15_000 })
    await dialog.getByRole('button', { name: 'Confirm' }).first().click()

    // Should advance to second cluster's Review Outing step
    await expect(dialog.getByText('Review Outing')).toBeVisible({ timeout: 15_000 })

    // Confirm second outing
    await dialog.getByRole('button', { name: /Continue to Species/i }).click()
    await expect(dialog.getByText(/Chukar|Jay/)).toBeVisible({ timeout: 15_000 })
    await dialog.getByRole('button', { name: 'Confirm' }).first().click()

    // Dialog auto-closes after all species saved
    await expect(dialog).not.toBeVisible({ timeout: 15_000 })

    // Navigate to Outings — should have 2 separate outings
    await page.getByRole('tab', { name: 'Outings' }).first().click()
    await expect(page.getByText('Your Outings')).toBeVisible({ timeout: 5_000 })

    // The outings page should show "2 outings recorded"
    await expect(page.getByText('2 outings recorded')).toBeVisible({ timeout: 5_000 })
  })
})
