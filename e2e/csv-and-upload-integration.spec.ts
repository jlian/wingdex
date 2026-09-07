import type { Page, Route } from '@playwright/test'
import { test, expect } from './fixtures'
import path from 'path'
import { readFileSync } from 'fs'
import sharp from 'sharp'
import { loadApp } from './helpers'

// ── Fixture helpers ──────────────────────────────────────────────


/**
 * Identification runs ON DEVICE now, so there is no endpoint to stub. These
 * tests therefore exercise the REAL model: preprocessing, the int8 tower, the
 * classifier and the geo/month prior all run for real.
 *
 * That means the assertions below check INVARIANTS, not a specific species.
 * Asserting "the model says Chukar" would couple the browser suite to model
 * weights, so every retrain would break tests that are not about accuracy.
 * Accuracy is owned by ml/parity/jobs/rank_parity.ts, which scores all 11,070
 * calibration photos. What these tests own is the FLOW: a photo goes in, some
 * species comes out, the user can confirm it, and it persists.
 *
 * Clears the one-time download gate so the flow reaches identification.
 */
async function passModelGate(page: Page) {
  // The gate renders INSIDE the upload dialog, after "Continue to Species", so
  // this must be called at that point rather than before the dialog opens.
  const gate = page.getByRole('button', { name: 'Download and continue' })
  const error = page.getByText(/^Download failed:/)
  const result = page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).first()
  const handedOff = page.getByText(/Identifying species/i)
  await expect(gate.or(handedOff).or(result).first()).toBeVisible()
  if (await gate.isVisible()) {
    await gate.click()
  }
  await expect(result.or(error).first()).toBeVisible({ timeout: 30_000 })
  if (await error.isVisible()) throw new Error(await error.innerText())
}

/** Mock WingDex geocoding routes to return a canned normalized location. */
function mockGeocoding(page: Page, locationName: string) {
  return page.route('**/api/geocoding/**', (route: Route) => {
    const url = new URL(route.request().url())
    if (url.pathname.includes('reverse')) {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          result: {
            label: locationName,
            lat: 47.66,
            lon: -122.41,
            stateProvince: 'US-WA',
            countryCode: 'US',
          },
        }),
      })
    } else {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [{
            label: locationName,
            lat: 47.66,
            lon: -122.41,
            stateProvince: 'US-WA',
            countryCode: 'US',
          }],
        }),
      })
    }
  })
}

// ── Tests ────────────────────────────────────────────────────────

test.describe('CSV import + photo upload integration', () => {

  test('full photo upload flow: upload → AI identify → confirm → saved to WingDex', async ({ page }) => {
    // A fresh browser context downloads model assets and initializes ONNX.
    // Keep that explicit budget separate from ordinary navigation tests.
    test.slow()
    await mockGeocoding(page, 'Haleakala National Park, Maui')

    await loadApp(page, { promote: false })

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
    await expect(dialog.getByText('Review Outing')).toBeVisible({ timeout: 10_000 })

    // Click continue to species identification
    await dialog.getByRole('button', { name: /Continue to Species/i }).click()

    // First identification triggers the 61.66 MiB download gate.
    await passModelGate(page)

    // Wait for AI processing, then the confirm step (scope to dialog)
    // Some species must be offered. Which one is the model's business, and is
    // covered by the parity harness rather than here.
    await expect(
      dialog.getByRole('button', { name: 'Confirm' }).first()
    ).toBeVisible({ timeout: 120_000 })

    // Peek at the candidate before confirming. The links come from the bundled
    // taxonomy, so they resolve even with Wikipedia stubbed out above.
    await dialog.getByRole('button', { name: /^Learn more about / }).first().click()
    const peek = page.locator('[data-slot="sheet-content"]')
    await expect(peek).toBeVisible({ timeout: 5_000 })
    await expect(peek.getByRole('link', { name: 'Wikipedia' })).toBeVisible()
    await expect(peek.getByRole('link', { name: 'eBird' })).toBeVisible()
    // Peeking is read-only: dismissing without confirming must leave the wizard
    // exactly as it was.
    await expect(peek.getByRole('button', { name: 'Confirm' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(peek).not.toBeVisible({ timeout: 5_000 })

    // Which species the model picked is not this test's business, so the species
    // the sheet commits is read off the sheet rather than named here. Reopening
    // and confirming from inside is the path that must reach the save request.
    await dialog.getByRole('button', { name: /^Learn more about / }).first().click()
    await expect(peek).toBeVisible({ timeout: 5_000 })
    const peekedSpecies = await peek.getByRole('heading').first().innerText()
    expect(peekedSpecies.trim().length).toBeGreaterThan(0)

    const saveObservationsResponse = page.waitForResponse(
      response => response.url().includes('/api/data/observations') && response.request().method() === 'POST'
    )

    // Confirm from inside the sheet. This is the new commit path, so the assertion
    // that matters is that the saved species is the one the sheet was showing,
    // not merely that something saved.
    await peek.getByRole('button', { name: 'Confirm' }).click()
    await expect(peek).not.toBeVisible({ timeout: 5_000 })

    const saved = await saveObservationsResponse
    // The POST body is a bare array of observations.
    const savedObservations = saved.request().postDataJSON() as Array<{ speciesName?: string }>
    const savedNames = savedObservations.map(o => o.speciesName ?? '')
    // One confirm, one observation: a duplicate-confirm regression shows up here.
    expect(savedNames).toHaveLength(1)
    expect(savedNames[0]).toContain(peekedSpecies.trim())

    // Dialog shows upload summary - dismiss it
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click()

    // Closing the flow after the first save is where the one sign-up prompt
    // fires, and this is the only test that reaches it through a real upload.
    await expect(page.getByRole('heading', { name: 'Keep your WingDex' })).toBeVisible({ timeout: 5_000 })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 })

    // Navigate to Outings and verify the new outing is visible immediately (no refresh)
    await page.getByRole('tab', { name: 'Outings' }).first().click()
    await expect(page.getByText('Your Outings')).toBeVisible({ timeout: 5_000 })
    const outingsPanel = page.getByRole('tabpanel', { name: 'Outings' })
    await expect(outingsPanel.getByText('Haleakala National Park, Maui')).toBeVisible({ timeout: 5_000 })

    // The observation must be SAVED. Which species the model picked is not this
    // test's business, so assert the dex is non-empty rather than naming one.
    await page.getByRole('tab', { name: 'WingDex' }).first().click()
    await expect(page.getByPlaceholder('Search species...')).toBeVisible({ timeout: 5_000 })
    await expect(
      page.locator('p:visible', { hasText: 'species observed' }).first()
    ).toBeVisible({ timeout: 5_000 })
  })

  test('current location for a photo without GPS persists through sighting confirmation', async ({ page, context }) => {
    test.slow()
    await context.grantPermissions(['geolocation'])
    await context.setGeolocation({ latitude: 47.612345, longitude: -122.312345, accuracy: 5000 })
    await mockGeocoding(page, 'Current location park')
    await loadApp(page, { promote: false })
    const image = await sharp('src/assets/images/Chukar_partridge_near_Haleakala_summit_Maui.jpg').jpeg().toBuffer()
    await page.getByRole('button', { name: 'Upload & Identify' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('input[type="file"]').setInputFiles({ name: 'no-gps.jpg', mimeType: 'image/jpeg', buffer: image })
    await expect(dialog.getByText('No GPS data in photo')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Tap to set location' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Use current location', exact: true })).not.toBeVisible()
    await dialog.getByRole('button', { name: 'Tap to set location' }).click()
    await expect(dialog.getByPlaceholder('Search for a place...')).toBeFocused()

    const reverseRequest = page.waitForRequest('**/api/geocoding/reverse')
    await dialog.getByRole('button', { name: 'Use current location', exact: true }).click()
    expect((await reverseRequest).postDataJSON()).toEqual({ lat: 47.612345, lon: -122.312345 })
    await expect(dialog.getByText('Current location', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Current location park' })).toBeVisible()
    await dialog.getByRole('button', { name: /Continue to Species/i }).click()
    await passModelGate(page)
    const confirm = dialog.getByRole('button', { name: 'Confirm', exact: true }).first()
    await expect(confirm).toBeVisible({ timeout: 120_000 })
    await confirm.click()
    await expect(dialog.getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 15_000 })

    const saved = await page.request.get('/api/data/all')
    expect(saved.ok()).toBe(true)
    const data = await saved.json()
    expect(data.outings).toEqual([expect.objectContaining({
      locationName: 'Current location park', defaultLocationName: 'Current location park',
      lat: 47.612345, lon: -122.312345, stateProvince: 'US-WA', countryCode: 'US',
    })])
    expect(data.observations).toHaveLength(1)
    expect(data.photos).toHaveLength(1)
    expect(data.photos[0].gps).toBeUndefined()
  })

  test('denied current location keeps manual location entry available', async ({ page, context }) => {
    // Grant an unrelated permission to explicitly deny geolocation in Chromium.
    await context.grantPermissions(['notifications'])
    await loadApp(page, { promote: false })
    const image = await sharp('src/assets/images/Chukar_partridge_near_Haleakala_summit_Maui.jpg').jpeg().toBuffer()
    await page.getByRole('button', { name: 'Upload & Identify' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('input[type="file"]').setInputFiles({ name: 'no-gps.jpg', mimeType: 'image/jpeg', buffer: image })
    await dialog.getByRole('button', { name: 'Tap to set location' }).click()
    await dialog.getByRole('button', { name: 'Use current location', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('Location access was denied')
    await dialog.getByPlaceholder('Search for a place...').fill('My park')
    await dialog.getByRole('button', { name: 'Use entered name without searching' }).click()
    await expect(dialog.getByRole('button', { name: 'My park', exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /Continue to Species/i })).toBeEnabled()
  })

  // @live: asserts CONVERGENCE onto a named species, which needs a known
  // identity. On-device inference cannot guarantee one without pinning weights,
  // and species agreement is what ml/parity/jobs/rank_parity.ts measures across
  // 11,070 photos. Kept runnable on demand against a real model.
  test('@live species convergence: CSV import + photo upload for same species increases count', async ({ page }) => {
    test.slow()
    // Seed CSV data (includes Chukar) via direct API calls
    await loadApp(page)

    const csvBuffer = readFileSync(path.resolve('e2e/fixtures/ebird-import.csv'))
    const imported = await page.request.post('/api/import/ebird-csv', {
      multipart: {
        file: { name: 'ebird-import.csv', mimeType: 'text/csv', buffer: csvBuffer },
      },
    })
    expect(imported.ok()).toBe(true)

    // Reload so the UI picks up the seeded data
    await page.reload()
    await expect(page.locator('header')).toBeVisible({ timeout: 5_000 })

    // Verify Chukar is in the dex from CSV
    await page.getByRole('tab', { name: 'WingDex' }).first().click()
    await expect(page.locator('p:visible', { hasText: 'species observed' }).first()).toBeVisible({ timeout: 5_000 })
    await page.getByPlaceholder('Search species...').fill('chukar')
    await expect(page.locator('p:visible', { hasText: 'Chukar' }).first()).toBeVisible()

    // Now upload a Chukar photo, the same species should converge
    await mockGeocoding(page, 'Haleakala National Park, Maui')

    // Navigate home and open upload wizard
    await page.getByRole('button', { name: 'Home' }).click()
    await expect(page.getByRole('button', { name: 'Upload & Identify' })).toBeVisible({ timeout: 5_000 })
    await page.getByRole('button', { name: 'Upload & Identify' }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })

    const fileInput = page.getByRole('dialog').locator('input[type="file"]')
    await fileInput.setInputFiles(
      path.resolve('src/assets/images/Chukar_partridge_near_Haleakala_summit_Maui.jpg')
    )

    // Review outing → continue → confirm (scope to dialog)
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Review Outing')).toBeVisible({ timeout: 10_000 })
    await dialog.getByRole('button', { name: /Continue to Species/i }).click()

    // First identification triggers the 61.66 MiB download gate.
    await passModelGate(page)
    // Some species must be offered. Which one is the model's business, and is
    // covered by the parity harness rather than here.
    await expect(
      dialog.getByRole('button', { name: 'Confirm' }).first()
    ).toBeVisible({ timeout: 120_000 })
    await dialog.getByRole('button', { name: 'Confirm' }).first().click()

    // Dialog shows upload summary - dismiss it
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 })

    // Go to WingDex, Chukar should still be there (converged, not duplicated)
    await page.getByRole('tab', { name: 'WingDex' }).first().click()
    await expect(page.locator('p:visible', { hasText: 'species observed' }).first()).toBeVisible({ timeout: 5_000 })
    await page.getByPlaceholder('Search species...').fill('chukar')

    // Count the Chukar entries, should be exactly 1 (not 2 separate entries)
    const chukarEntries = page.locator('p:visible', { hasText: /^Chukar/ })
    await expect(chukarEntries).toHaveCount(1)

    // Click into Chukar detail to verify the sighting count increased
    await chukarEntries.first().click()
    await expect(page.getByRole('heading', { name: 'Chukar' })).toBeVisible({ timeout: 5_000 })

    // Should show 2 outings for this species (one from CSV, one from photo upload)
    await expect(page.getByText(/2.*outing/i)).toBeVisible({ timeout: 5_000 })
  })

  // @live: needs two photos to identify as DIFFERENT named species to prove the
  // outings split. The clustering logic it targets is geographic, and is covered
  // by unit tests; only the species labels here required the old per-call mock.
  test('@live multi-photo clustering: photos from different locations create separate outings', async ({ page }) => {
    test.slow()
    await mockGeocoding(page, 'Discovery Park, Seattle')

    await loadApp(page, { promote: false })

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
    await expect(dialog.getByText('Review Outing')).toBeVisible({ timeout: 10_000 })

    // The wizard should indicate multiple clusters (e.g., "Review Outing 1 of 2")
    await expect(dialog.getByRole('heading', { name: /Review Outing 1 of 2/i })).toBeVisible({ timeout: 5_000 })

    // Confirm first outing → identify species → confirm
    await dialog.getByRole('button', { name: /Continue to Species/i }).click()

    // First identification triggers the 61.66 MiB download gate.
    await passModelGate(page)
    await expect(dialog.getByText(/Chukar|Jay/)).toBeVisible({ timeout: 10_000 })
    await dialog.getByRole('button', { name: 'Confirm' }).first().click()

    // Should advance to second cluster's Review Outing step
    await expect(dialog.getByText('Review Outing')).toBeVisible({ timeout: 10_000 })
    await expect(dialog.getByRole('heading', { name: /Review Outing 2 of 2/i })).toBeVisible({ timeout: 5_000 })

    // Confirm second outing
    await dialog.getByRole('button', { name: /Continue to Species/i }).click()

    // First identification triggers the 61.66 MiB download gate.
    await passModelGate(page)
    await expect(dialog.getByText(/Chukar|Jay/)).toBeVisible({ timeout: 10_000 })
    await dialog.getByRole('button', { name: 'Confirm' }).first().click()

    // Dialog shows upload summary - dismiss it
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await dialog.getByRole('button', { name: 'Done' }).click()

    // The one sign-up prompt fires as the flow closes on a first save.
    await expect(page.getByRole('heading', { name: 'Keep your WingDex' })).toBeVisible({ timeout: 5_000 })
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible({ timeout: 10_000 })
  })
})
