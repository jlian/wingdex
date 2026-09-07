import { test, expect } from './fixtures'
import { loadApp } from './helpers'

test('appearance controls change the rendered theme and persist the preference', async ({ page }) => {
  await loadApp(page)
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible()
  for (const name of ['Light', 'Dark', 'System']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  }

  await page.getByRole('button', { name: 'Light', exact: true }).click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  const lightBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(lightBackground).not.toBe('rgba(0, 0, 0, 0)')

  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .not.toBe(lightBackground)
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark')

  await page.reload()
  await expect(page.locator('header')).toBeVisible()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Light', exact: true }).click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)

  await page.emulateMedia({ colorScheme: 'dark' })
  await page.getByRole('button', { name: 'System', exact: true }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).not.toHaveClass(/dark/)
})
