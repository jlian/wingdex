import { test, expect } from '@playwright/test'
import { injectSeedData } from './helpers'

test.describe('App with seeded data', () => {
  test('home page shows correct stat cards', async ({ page }) => {
    await injectSeedData(page)

    // Hero count should reflect seeded data (count and text are separate <p> tags on home page)
    await expect(page.locator('p:visible', { hasText: 'species observed' }).first()).toBeVisible({ timeout: 5_000 })
  })

  test('home page shows recent species section', async ({ page }) => {
    await injectSeedData(page)

    await expect(page.getByText('Recent Species')).toBeVisible({ timeout: 5_000 })
    // A known recent species from the full fixture should appear
    await expect(page.getByRole('button', { name: 'Common Goldeneye' }).first()).toBeVisible()
  })

  test('outings page lists seeded outings', async ({ page }) => {
    await injectSeedData(page)

    await page.getByRole('tab', { name: 'Outings' }).first().click()
    await expect(page.getByText('Your Outings')).toBeVisible({ timeout: 5_000 })

    // Should show location names from sanitized seed data
    await expect(page.locator('p:visible', { hasText: 'Discovery Park' }).first()).toBeVisible()
    await expect(page.locator('p:visible', { hasText: 'Union Bay' }).first()).toBeVisible()
  })

  test('clicking an outing opens its detail view', async ({ page }) => {
    await injectSeedData(page)

    await page.getByRole('tab', { name: 'Outings' }).first().click()
    await expect(page.getByText('Your Outings')).toBeVisible({ timeout: 5_000 })

    // Click a known outing from the seed fixture
    await page.locator('p:visible', { hasText: 'Montrose Point' }).first().click()
    await page.waitForTimeout(1000)

    // Detail view should show a heading with the location name
    await expect(page.getByRole('heading', { name: 'Montrose Point' })).toBeVisible()
    // Should show species from that outing
    await expect(page.locator('p:visible', { hasText: 'Northern Cardinal' }).first()).toBeVisible()
  })

  test('wingdex page lists species with count', async ({ page }) => {
    await injectSeedData(page)

    await page.getByRole('tab', { name: 'WingDex' }).first().click()
    await expect(page.locator('p:visible', { hasText: 'species observed' }).first()).toBeVisible({ timeout: 5_000 })

    // Known seed species should appear in the list
    await expect(page.locator('p:visible', { hasText: 'Common Goldeneye' }).first()).toBeVisible()
    await expect(page.locator('p:visible', { hasText: 'Golden-crowned Kinglet' }).first()).toBeVisible()
  })

  test('wingdex search filters species', async ({ page }) => {
    await injectSeedData(page)

    await page.getByRole('tab', { name: 'WingDex' }).first().click()
    await expect(page.locator('p:visible', { hasText: 'species observed' }).first()).toBeVisible({ timeout: 5_000 })

    // Search for "eagle"
    await page.getByPlaceholder('Search species...').fill('eagle')
    await page.waitForTimeout(500)

    // Should show Bald Eagle but not unrelated species
    await expect(page.locator('p:visible', { hasText: 'Bald Eagle' }).first()).toBeVisible()
    await expect(page.locator('p:visible', { hasText: 'Blue Jay' })).toHaveCount(0)
  })

  test('clicking a species opens its detail view', async ({ page }) => {
    await injectSeedData(page)

    await page.getByRole('tab', { name: 'WingDex' }).first().click()
    await expect(page.locator('p:visible', { hasText: 'species observed' }).first()).toBeVisible({ timeout: 5_000 })

    await page.locator('p:visible', { hasText: 'Common Goldeneye' }).first().click()
    await page.waitForTimeout(1000)

    // Detail view should show species info
    await expect(page.getByRole('heading', { name: 'Common Goldeneye' })).toBeVisible()
    // Should show a back button
    await expect(page.getByRole('button', { name: /back/i })).toBeVisible()
  })

  test('species detail view loads Wikipedia image', async ({ page }) => {
    await injectSeedData(page)

    await page.getByRole('tab', { name: 'WingDex' }).first().click()
    await expect(page.locator('p:visible', { hasText: 'species observed' }).first()).toBeVisible({ timeout: 5_000 })

    await page.locator('p:visible', { hasText: 'Common Goldeneye' }).first().click()
    await page.waitForTimeout(1000)

    await expect(page.getByRole('heading', { name: 'Common Goldeneye' })).toBeVisible()

    // Wikipedia image should load in the detail hero area
    const heroImg = page.getByRole('img', { name: 'Common Goldeneye' })
    await expect(heroImg).toBeVisible({ timeout: 10_000 })
    // Verify it loaded a real image (not a placeholder)
    const src = await heroImg.getAttribute('src')
    expect(src).toBeTruthy()
    expect(src).toContain('wikimedia')
  })
})
