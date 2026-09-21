import { test, expect } from './fixtures'

test('privacy and terms share their layout across themes and viewport sizes', async ({ page }) => {
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      const layouts: unknown[] = []
      for (const [path, title] of [['/privacy.html', 'Privacy Policy'], ['/terms.html', 'Terms of Use']]) {
        await page.goto(path)
        await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
        layouts.push(await page.locator('article').evaluate(article => {
          const container = article.parentElement!
          const heading = article.querySelector('h3')!
          const styles = getComputedStyle(article)
          const box = container.getBoundingClientRect()
          const containerStyles = getComputedStyle(container)
          return {
            x: box.x,
            width: box.width,
            padding: containerStyles.padding,
            fontSize: styles.fontSize,
            lineHeight: styles.lineHeight,
            color: styles.color,
            headingFontSize: getComputedStyle(heading).fontSize,
            sectionSpacing: getComputedStyle(article.children[1]).marginTop,
          }
        }))
        expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(width)
      }
      expect(layouts[0]).toEqual(layouts[1])
    }
  }
})
