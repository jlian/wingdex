import { test, expect } from '@playwright/test'
import { injectSeedData } from './helpers'

test.describe('App with seeded data', () => {
  test('home page shows correct stat cards', async ({ page }) => {
    await injectSeedData(page)

    // Stat cards should reflect seeded data: 17 confirmed species, 5 outings
    await expect(page.getByText('Species').first()).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText('17', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Outings').first()).toBeVisible()
    await expect(page.getByText('5', { exact: true }).first()).toBeVisible()
  })

  test('home page shows recent species section', async ({ page }) => {
    await injectSeedData(page)

    await expect(page.getByText('Recent Species')).toBeVisible({ timeout: 5_000 })
    // At least one known seed species should appear in the recent section
    await expect(page.getByRole('button', { name: 'Northern Cardinal' }).first()).toBeVisible()
  })

  test('outings page lists seeded outings', async ({ page }) => {
    await injectSeedData(page)

    await page.getByRole('tab', { name: 'Outings' }).first().click()
    await expect(page.getByText('Your Outings')).toBeVisible({ timeout: 5_000 })

    // Should show location names from seed data
    await expect(page.getByText('Central Park, New York').first()).toBeVisible()
    await expect(page.getByText('Jamaica Bay Wildlife Refuge').first()).toBeVisible()
  })

  test('clicking an outing opens its detail view', async ({ page }) => {
    await injectSeedData(page)

    await page.getByRole('tab', { name: 'Outings' }).first().click()
    await expect(page.getByText('Your Outings')).toBeVisible({ timeout: 5_000 })

    // Click the first outing (Central Park, most recent)
    await page.getByText('Central Park, New York').first().click()
    await page.waitForTimeout(1000)

    // Detail view should show a heading with the location name
    await expect(page.getByRole('heading', { name: 'Central Park, New York' })).toBeVisible()
    // Should show species from that outing
    await expect(page.getByText('Northern Cardinal').first()).toBeVisible()
  })

  test('birddex page lists species with count', async ({ page }) => {
    await injectSeedData(page)

    await page.getByRole('tab', { name: 'BirdDex' }).first().click()
    await expect(page.getByText('17 species observed')).toBeVisible({ timeout: 5_000 })

    // Known seed species should appear in the list
    await expect(page.getByText('Northern Cardinal').first()).toBeVisible()
    await expect(page.getByText('Bald Eagle').first()).toBeVisible()
  })

  test('birddex search filters species', async ({ page }) => {
    await injectSeedData(page)

    await page.getByRole('tab', { name: 'BirdDex' }).first().click()
    await expect(page.getByText('17 species observed')).toBeVisible({ timeout: 5_000 })

    // Search for "hawk"
    await page.getByPlaceholder('Search species...').fill('hawk')
    await page.waitForTimeout(500)

    // Should show Red-tailed Hawk but not unrelated species
    await expect(page.getByText('Red-tailed Hawk').first()).toBeVisible()
    await expect(page.getByText('Blue Jay')).not.toBeVisible()
  })

  test('clicking a species opens its detail view', async ({ page }) => {
    await injectSeedData(page)

    await page.getByRole('tab', { name: 'BirdDex' }).first().click()
    await expect(page.getByText('17 species observed')).toBeVisible({ timeout: 5_000 })

    await page.getByText('Northern Cardinal').first().click()
    await page.waitForTimeout(1000)

    // Detail view should show species info
    await expect(page.getByRole('heading', { name: 'Northern Cardinal' })).toBeVisible()
    // Should show a back button or breadcrumb
    await expect(
      page.getByRole('button', { name: /back/i })
        .or(page.getByText('BirdDex').first())
    ).toBeVisible()
  })
})
