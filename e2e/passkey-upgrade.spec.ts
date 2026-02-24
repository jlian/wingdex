import { test, expect } from '@playwright/test'
import { loadApp, promoteAnonymousUser } from './helpers'

test.describe('Passkey upgrade auth gate', () => {
  test('blocks anonymous AI calls and allows upgraded users', async ({ page }) => {
    await loadApp(page, { promote: false })

    const anonymousIdentify = await page.request.post('/api/identify-bird', {
      multipart: {},
    })
    expect(anonymousIdentify.status()).toBe(403)
    const anonymousBody = await anonymousIdentify.text()
    expect(anonymousBody).toContain('Account required')

    await promoteAnonymousUser(page)

    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: 'Log in' })).toHaveCount(0)

    const upgradedIdentify = await page.request.post('/api/identify-bird', {
      multipart: {},
    })
    expect(upgradedIdentify.status()).toBe(400)
    const upgradedBody = await upgradedIdentify.text()
    expect(upgradedBody).toContain('Missing image')
  })
})
