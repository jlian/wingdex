import { test } from '@playwright/test'

const BASE = 'http://localhost:5000'

test.describe('Visual screenshots', () => {
  // Desktop screenshots
  test('desktop - homepage', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()
    await page.goto(BASE)
    await page.waitForSelector('text=BirdDex', { timeout: 10000 })
    // Wait for wiki images to start loading
    await page.waitForTimeout(3000)
    await page.screenshot({ path: 'screenshots/desktop-home.png', fullPage: true })
    await ctx.close()
  })

  test('desktop - outings', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()
    await page.goto(BASE)
    await page.waitForSelector('text=BirdDex', { timeout: 10000 })
    await page.click('text=Outings')
    await page.waitForTimeout(1000)
    await page.screenshot({ path: 'screenshots/desktop-outings.png', fullPage: true })
    await ctx.close()
  })

  test('desktop - life list', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()
    await page.goto(BASE)
    await page.waitForSelector('text=BirdDex', { timeout: 10000 })
    await page.click('text=Life List')
    await page.waitForTimeout(3000)
    await page.screenshot({ path: 'screenshots/desktop-lifelist.png', fullPage: true })
    await ctx.close()
  })

  test('desktop - settings', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()
    await page.goto(BASE)
    await page.waitForSelector('text=BirdDex', { timeout: 10000 })
    await page.click('text=Settings')
    await page.waitForTimeout(1000)
    await page.screenshot({ path: 'screenshots/desktop-settings.png', fullPage: true })
    await ctx.close()
  })

  // Mobile screenshots
  test('mobile - homepage', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await ctx.newPage()
    await page.goto(BASE)
    await page.waitForSelector('text=BirdDex', { timeout: 10000 })
    await page.waitForTimeout(3000)
    await page.screenshot({ path: 'screenshots/mobile-home.png', fullPage: true })
    await ctx.close()
  })

  test('mobile - life list', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await ctx.newPage()
    await page.goto(BASE)
    await page.waitForSelector('text=BirdDex', { timeout: 10000 })
    // On mobile, click the bottom nav
    await page.click('nav >> text=Life List')
    await page.waitForTimeout(3000)
    await page.screenshot({ path: 'screenshots/mobile-lifelist.png', fullPage: true })
    await ctx.close()
  })

  test('mobile - outings', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await ctx.newPage()
    await page.goto(BASE)
    await page.waitForSelector('text=BirdDex', { timeout: 10000 })
    await page.click('nav >> text=Outings')
    await page.waitForTimeout(1000)
    await page.screenshot({ path: 'screenshots/mobile-outings.png', fullPage: true })
    await ctx.close()
  })
})
