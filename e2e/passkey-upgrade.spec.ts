import { test, expect } from '@playwright/test'
import { loadApp, promoteAnonymousUser } from './helpers'

test.describe('Passkey upgrade auth gate', () => {
  test('blocks anonymous AI calls and allows upgraded users', async ({ page }) => {
    await loadApp(page, { promote: false })

    const sessionResponse = await page.request.get('/api/auth/get-session')
    const sessionBody = await sessionResponse.json().catch(() => null)
    const isAnonymous = Boolean(
      sessionBody &&
        typeof sessionBody === 'object' &&
        (sessionBody as { user?: { isAnonymous?: unknown } }).user?.isAnonymous
    )

    const anonymousIdentify = await page.request.post('/api/identify-bird', {
      multipart: {},
    })
    const anonymousBody = await anonymousIdentify.text()
    if (isAnonymous) {
      expect(anonymousIdentify.status()).toBe(403)
      expect(anonymousBody).toContain('Account required')
      await promoteAnonymousUser(page)
    } else {
      expect(anonymousIdentify.status()).not.toBe(403)
    }

    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole('button', { name: 'Log in' })).toHaveCount(0)

    const upgradedIdentify = await page.request.post('/api/identify-bird', {
      multipart: {},
    })
    expect(upgradedIdentify.status()).not.toBe(403)
    const upgradedBody = await upgradedIdentify.text()
    expect(upgradedBody).not.toContain('Account required')
  })
})
