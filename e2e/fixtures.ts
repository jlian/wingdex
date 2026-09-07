import { test as base, expect } from '@playwright/test'

export const test = base.extend({
  page: async ({ page }, runPage) => {
    await page.route(/^https:\/\/en\.wikipedia\.org\//, route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        title: 'Bird',
        extract: 'A deterministic bird summary.',
        originalimage: { source: 'https://upload.wikimedia.org/wingdex-test/bird.svg' },
        content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Bird' } },
      }),
    }))
    await page.route(/^https:\/\/upload\.wikimedia\.org\//, route => route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#547a52"/></svg>',
    }))
    await runPage(page)
  },
})

export { expect }
