import { test, expect } from './fixtures'
import { seedViaCSVImport } from './helpers'

test.describe('App with seeded data', () => {
  test('imported data is browsable across home, outings, species and export', async ({ page }) => {
    await seedViaCSVImport(page)
    await expect(page.locator('p:visible', { hasText: 'species observed' }).first()).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText('Recent Species')).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('section').filter({ hasText: 'Recent Species' }).locator('button').first()).toBeVisible()

    await page.getByRole('tab', { name: 'Outings' }).first().click()
    await expect(page.getByText('Your Outings')).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('p:visible', { hasText: 'Discovery Park' }).first()).toBeVisible()
    await expect(page.locator('p:visible', { hasText: 'Hyde Park, London' }).first()).toBeVisible()
    await page.locator('p:visible', { hasText: 'Discovery Park' }).first().click()
    await expect(page.getByRole('heading', { name: 'Discovery Park' })).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('p:visible', { hasText: 'Northern Cardinal' }).first()).toBeVisible()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export eBird CSV' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toContain('wingdex-outing-')
    expect(download.suggestedFilename()).toMatch(/\.csv$/)

    await page.getByRole('tab', { name: 'WingDex' }).first().click()
    await expect(page.locator('p:visible', { hasText: 'species observed' }).first()).toBeVisible({ timeout: 5_000 })
    const wingdexSearch = page.getByPlaceholder('Search species...')
    await wingdexSearch.fill('great blue heron')
    await expect(page.locator('p:visible', { hasText: 'Great Blue Heron' }).first()).toBeVisible()
    await wingdexSearch.fill('eagle')
    await expect(page.locator('p:visible', { hasText: 'Bald Eagle' }).first()).toBeVisible()
    await expect(page.locator('p:visible', { hasText: 'Blue Jay' })).toHaveCount(0)
    await page.locator('p:visible', { hasText: 'Bald Eagle' }).first().click()
    await expect(page.getByRole('heading', { name: 'Bald Eagle' })).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole('button', { name: /back/i })).toBeVisible()

    await page.getByRole('button', { name: 'Settings' }).click()
    for (const name of ['Settings', 'Appearance', 'Import & Export', 'Account Management']) {
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    }
    await page.getByRole('button', { name: 'Home' }).click()
    await expect(page.getByRole('button', { name: 'Upload & Identify' })).toBeVisible()
  })

  test('species detail view loads Wikipedia image', async ({ page }) => {
    const portraitImageURL = 'https://upload.wikimedia.org/wingdex-test/portrait.svg'
    let mockedSandhillImageRequests = 0
    await page.route('**/api/rest_v1/page/summary/**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        title: 'Sandhill crane',
        extract: 'A stable test summary.',
        originalimage: { source: portraitImageURL },
        content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Sandhill_crane' } },
      }),
    }))
    await page.route(portraitImageURL, route => route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="600"><rect width="300" height="600" fill="#547a52"/></svg>',
    }))
    await page.route('**/Sandhill_Crane_JG.jpg/**', route => {
      mockedSandhillImageRequests += 1
      return route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="600"><rect width="300" height="600" fill="#547a52"/></svg>',
      })
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await seedViaCSVImport(page)

    await page.getByRole('tab', { name: 'WingDex' }).first().click()
    await expect(page.locator('p:visible', { hasText: 'species observed' }).first()).toBeVisible({ timeout: 5_000 })
    await page.getByPlaceholder('Search species...').fill('sandhill crane')

    await page.locator('p:visible', { hasText: 'Sandhill Crane' }).first().click()

    await expect(page.getByRole('heading', { name: 'Sandhill Crane' })).toBeVisible({ timeout: 5_000 })

    // Wikipedia image should load in the detail hero area
    const heroImg = page.getByRole('img', { name: 'Sandhill Crane' })
    await expect(heroImg).toBeVisible({ timeout: 10_000 })
    // Verify it loaded a real image (not a placeholder)
    const src = await heroImg.getAttribute('src')
    expect(src).toBeTruthy()
    expect(src).toContain('wikimedia')
    await expect.poll(
      () => heroImg.evaluate(image => image.naturalWidth),
      { timeout: 10_000 },
    ).toBeGreaterThan(0)

    const mobileHeroGeometry = await heroImg.evaluate(image => {
      const container = image.parentElement
      if (!container) throw new Error('Species hero has no container')
      const bounds = container.getBoundingClientRect()
      return {
        width: bounds.width,
        height: bounds.height,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        objectPosition: getComputedStyle(image).objectPosition,
      }
    })
    expect(mobileHeroGeometry.naturalHeight).toBeGreaterThan(mobileHeroGeometry.naturalWidth)
    expect(mockedSandhillImageRequests).toBeGreaterThan(0)
    expect(Math.abs(mobileHeroGeometry.width - mobileHeroGeometry.height)).toBeLessThanOrEqual(2)
    expect(mobileHeroGeometry.objectPosition).toBe('50% 50%')

    await page.setViewportSize({ width: 900, height: 900 })
    const wideHeroGeometry = await heroImg.evaluate(image => {
      const container = image.parentElement
      if (!container) throw new Error('Species hero has no container')
      const bounds = container.getBoundingClientRect()
      return {
        width: bounds.width,
        height: bounds.height,
        objectPosition: getComputedStyle(image).objectPosition,
      }
    })
    expect(wideHeroGeometry.width / wideHeroGeometry.height).toBeCloseTo(4 / 3, 2)
    expect(wideHeroGeometry.objectPosition).toBe('50% 50%')
  })
})
