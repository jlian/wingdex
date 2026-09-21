import { test, expect } from './fixtures'
import { loadApp, seedViaCSVImport } from './helpers'

test('root delivers indexable HTML and works without JavaScript', async ({ request, browser }) => {
  const response = await request.get('/')
  expect(response.status()).toBe(200)
  const html = await response.text()
  expect(html).toContain('Bird photos in.')
  expect(html).toContain('Your photos are never uploaded')
  expect(html).toContain('https://wingdex.app/landing/social.png')
  expect(html).toContain('application/ld+json')
  expect(html).toContain('more than 10,000 bird species')
  expect(html).toContain('An account is required for import and export')
  expect(html).toContain('Free. No account needed.')
  expect(html).toContain('once the browser has downloaded the model')
  const sitemap = await request.get('/sitemap.xml')
  expect(sitemap.status()).toBe(200)
  expect(await sitemap.text()).toContain('<loc>https://wingdex.app/</loc>')
  expect(await (await request.get('/robots.txt')).text()).toContain('Sitemap: https://wingdex.app/sitemap.xml')
  const context = await browser.newContext({ javaScriptEnabled: false })
  try {
    const page = await context.newPage()
    await page.goto('/')
    await expect(page).toHaveTitle('WingDex - Free Bird Photo Identification & Life List')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bird photos in.Life list out.')
    await expect(page.locator('.landing-diagram')).toHaveCount(3)
    await expect(page.locator('.landing-diagram figcaption')).toHaveCount(0)
    await expect(page.getByRole('figure', { name: 'Example photos grouped by outing' })).toBeVisible()
    await expect(page.locator('.landing-comparison img').nth(0)).toHaveAttribute('src', '/landing/heron-reference.webp')
    await expect(page.locator('.landing-comparison img').nth(1)).toHaveAttribute('src', '/landing/heron.webp')
    await expect(page.locator('img[src*="life-list"], img[src*="outing"]')).toHaveCount(0)
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://wingdex.app/')
    await expect(page.getByRole('link', { name: 'Privacy', exact: true })).toHaveAttribute('href', '/privacy.html')
    const description = await page.locator('meta[name="description"]').getAttribute('content')
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', description!)
    await expect(page.locator('meta[name="twitter:description"]')).toHaveAttribute('content', description!)
    const schema = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!)
    expect(schema).toMatchObject({
      '@type': 'SoftwareApplication',
      url: 'https://wingdex.app/',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    })
  } finally {
    await context.close()
  }
})

test('example reveal respects reduced motion and only the hero is extra wide', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  const art = page.locator('.landing-hero-art')
  await expect(art).toHaveAttribute('data-reveal', 'ready')
  await expect(page.locator('.landing-bird-photo')).toHaveCSS('animation-name', 'none')
  await expect(page.locator('.landing-photo-label')).toHaveCSS('opacity', '1')
  expect(await page.locator('.landing-hero').evaluate(el => el.getBoundingClientRect().width)).toBe(1280)
  for (const section of await page.locator('.landing-section, .landing-privacy').all()) {
    expect(await section.evaluate(el => el.getBoundingClientRect().width)).toBe(768)
  }
  await expect(page.locator('.landing-ios').getByRole('button')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Upload & Identify' })).toHaveCount(1)
  await expect(page.locator('.landing-promise, .landing-wordmark')).toHaveCount(0)
  await expect(page.locator('.landing-field-note')).toHaveText('Free. No account needed.')
  await expect(page.locator('.landing-caption')).toHaveCount(0)
  const identificationCopy = await page.locator('.landing-identification > div').boundingBox()
  const identificationArt = await page.locator('.landing-identification > figure').boundingBox()
  const historyCopy = await page.locator('.landing-showcase > div').boundingBox()
  const historyArt = await page.locator('.landing-showcase > figure').boundingBox()
  expect(identificationCopy!.x).toBeLessThan(identificationArt!.x)
  expect(historyArt!.x).toBeLessThan(historyCopy!.x)
  const iosCopy = await page.locator('.landing-ios > div:first-child').boundingBox()
  const iosBadge = await page.locator('.landing-final-actions').boundingBox()
  expect(iosBadge!.x + iosBadge!.width).toBeLessThanOrEqual(iosCopy!.x)
  await page.setViewportSize({ width: 375, height: 812 })
  await expect(page.locator('.landing-ios')).toHaveCSS('flex-direction', 'column')
  for (const section of ['.landing-identification', '.landing-showcase']) {
    const copy = await page.locator(`${section} > div`).boundingBox()
    const art = await page.locator(`${section} > figure`).boundingBox()
    expect(copy!.y + copy!.height).toBeLessThanOrEqual(art!.y)
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(page.locator('.landing-bird-photo')).toHaveCSS('animation-name', 'landing-photo-focus')
  await expect(page.locator('.landing-photo-label')).toHaveCSS('animation-name', 'landing-identification-reveal')
  await expect(page.getByText('Example identification')).toBeVisible()
})

test('illustrations explain real workflows without creating records or a session', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  const groups = page.getByRole('group', { name: 'Explore example outings' })
  await groups.getByRole('button', { name: /Carkeek Park/ }).click()
  await expect(groups.getByRole('button', { name: /Carkeek Park/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.landing-batch-photos > [data-selected="true"]')).toHaveCount(2)
  await groups.getByRole('button', { name: /Union Bay/ }).click()
  await expect(page.locator('.landing-batch-photos > [data-selected="true"]')).toHaveCount(3)
  await page.getByRole('button', { name: 'Confirm example ID', exact: true }).click()
  await expect(page.getByText('Confirmed in this example', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Reset example', exact: true }).click()
  await expect(page.getByText('Suggested match, ready for review', { exact: true })).toBeVisible()
  const history = page.getByRole('group', { name: 'Example outing and species history' })
  await history.getByRole('button', { name: /Great Blue Heron/ }).focus()
  await page.keyboard.press('Enter')
  await expect(history).toBeFocused()
  await expect(history.getByText('3 seen · 2 outings · First May 4')).toBeVisible()
  await history.getByRole('button', { name: /Carkeek Park/ }).click()
  await expect(history.getByText('Jul 12 · 2 species · 3 birds')).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
  expect(await (await page.request.get('/api/auth/get-session')).json()).toBeNull()
})

test('fresh landing hydrates, stays sessionless, and starts upload directly', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Bird photos in.')
  const session = await page.request.get('/api/auth/get-session')
  expect(await session.json()).toBeNull()
  expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(375)
  const originalUrl = page.url()
  await page.getByRole('button', { name: 'Upload & Identify' }).first().click()
  await expect(page.getByRole('button', { name: 'Select Photos' })).toBeVisible()
  expect(page.url()).toBe(originalUrl)
  await expect(page.locator('.landing')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Bird photos in.')
  await page.getByRole('button', { name: 'Upload & Identify' }).first().click()
  await expect(page.getByRole('button', { name: 'Select Photos' })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Bird photos in.')
  expect(errors).toEqual([])
})

test('upload deep links stay in the compact app after the modal closes', async ({ page }) => {
  await page.goto('/#upload')
  await expect(page.getByRole('button', { name: 'Select Photos' })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: /Bird photos in/ })).toBeHidden()
  await expect(page).toHaveURL(/\/#home$/)
})

test('registered visitors reach their app and legal deep links remain available', async ({ page }) => {
  await loadApp(page)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Upload & Identify' }).first()).toBeVisible()
  await page.goto('/#privacy')
  await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible()
})

test('OAuth errors still reach the existing app notification', async ({ page }) => {
  await page.goto('/?error=access_denied')
  await expect(page.getByText('Sign-in failed: access_denied')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Upload & Identify' }).first()).toBeVisible()
})

for (const identity of ['anonymous', 'registered']) {
test(`returning ${identity} sightings never flash the landing while session and data load`, async ({ page }) => {
  if (identity === 'registered') {
    await seedViaCSVImport(page)
  } else {
    await page.goto('/')
    await page.getByRole('button', { name: 'Upload & Identify' }).first().click()
    await expect(page.getByRole('button', { name: 'Select Photos' })).toBeVisible()
    await expect.poll(async () => {
      const response = await page.request.get('/api/auth/get-session')
      return Boolean((await response.json())?.user)
    }).toBe(true)
    const outingId = `outing_${crypto.randomUUID()}`
    const response = await page.request.post('/api/data/outings', {
      data: { id: outingId, startTime: '2026-09-01T12:00:00Z', endTime: '2026-09-01T12:00:00Z', locationName: 'Garden', notes: '', createdAt: new Date().toISOString() },
    })
    expect(response.ok()).toBe(true)
    const observation = await page.request.post('/api/data/observations', {
      data: [{ id: `obs_${crypto.randomUUID()}`, outingId, speciesName: 'Rock Pigeon (Columba livia)', count: 1, certainty: 'confirmed', notes: '' }],
    })
    expect(observation.ok()).toBe(true)
  }
  await page.addInitScript(() => {
    const observed = { landingVisible: false }
    Object.assign(window, { landingObservation: observed })
    const sample = () => {
      const landing = document.querySelector('.landing')
      if (landing && landing.getBoundingClientRect().height > 0) observed.landingVisible = true
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  await page.route('**/api/auth/get-session*', async route => {
    await new Promise(resolve => setTimeout(resolve, 350))
    await route.continue()
  })
  await page.route('**/api/data/all', async route => {
    await new Promise(resolve => setTimeout(resolve, 350))
    await route.continue()
  })
  await page.goto('/')
  await expect(page.getByText('species observed')).toBeVisible()
  expect(await page.evaluate(() => Reflect.get(window, 'landingObservation').landingVisible)).toBe(false)
})
}

test('landing stays usable across sizes and themes', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  for (const width of [375, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => {
        localStorage.setItem('theme', value)
      }, theme)
      await page.reload()
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(width)
      const chrome = async () => page.evaluate(() => {
        const header = document.querySelector('header')!
        const main = document.querySelector('main')!
        const logo = header.querySelector('[aria-label="Home"] svg')!
        const footer = document.querySelector('footer')!
        return {
          headerHeight: header.getBoundingClientRect().height,
          headerColor: getComputedStyle(header).backgroundColor,
          logoX: logo.getBoundingClientRect().x,
          logoWidth: logo.getBoundingClientRect().width,
          mainWidth: main.getBoundingClientRect().width,
          background: getComputedStyle(document.body).backgroundColor,
          footerClasses: footer.className,
        }
      })
      const landingChrome = await chrome()
      await page.getByRole('tab', { name: 'Outings' }).click()
      await expect(page.getByText('No outings yet')).toBeVisible()
      const appChrome = await chrome()
      expect(appChrome).toEqual({ ...landingChrome, mainWidth: appChrome.mainWidth })
      if (width < 1280) expect(appChrome.mainWidth).toBe(landingChrome.mainWidth)
      else {
        expect(landingChrome.mainWidth).toBe(1280)
        expect(appChrome.mainWidth).toBe(768)
      }
      await page.getByRole('button', { name: 'Home', exact: true }).click()
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath(`landing-${width}-${theme}.png`), fullPage: true })
    }
  }
})
