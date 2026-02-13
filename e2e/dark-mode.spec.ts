import { test, expect } from '@playwright/test';

test.describe('Dark mode', () => {
  test('settings page shows appearance toggle with three options', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header')).toBeVisible({ timeout: 10_000 });

    // Navigate to Settings
    await page.getByRole('tab', { name: 'Settings' }).first().click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 5_000 });

    // Appearance section should be visible
    await expect(page.getByText('Appearance')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Light' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dark' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'System' })).toBeVisible();
  });

  test('clicking Dark applies .dark class to html', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header')).toBeVisible({ timeout: 10_000 });

    // Navigate to Settings
    await page.getByRole('tab', { name: 'Settings' }).first().click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 5_000 });

    // Click Dark
    await page.getByRole('button', { name: 'Dark' }).click();

    // <html> should have class="dark"
    const htmlClass = await page.locator('html').getAttribute('class');
    expect(htmlClass).toContain('dark');
  });

  test('clicking Light removes .dark class from html', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('tab', { name: 'Settings' }).first().click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 5_000 });

    // Switch to Dark first
    await page.getByRole('button', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    // Switch back to Light
    await page.getByRole('button', { name: 'Light' }).click();

    // Wait for the class to update
    await expect(page.locator('html')).not.toHaveClass(/dark/, { timeout: 3_000 });
  });

  test('dark mode changes background color', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header')).toBeVisible({ timeout: 10_000 });

    // Get light mode background color
    const lightBg = await page.evaluate(() =>
      getComputedStyle(document.body).backgroundColor
    );

    // Switch to dark
    await page.getByRole('tab', { name: 'Settings' }).first().click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    // Get dark mode background color
    const darkBg = await page.evaluate(() =>
      getComputedStyle(document.body).backgroundColor
    );

    // They should be different
    expect(darkBg).not.toBe(lightBg);
  });

  test('dark mode preference persists across page reloads', async ({ page }) => {
    // Don't use the beforeEach localStorage.clear for this test — 
    // we need localStorage to persist between navigations
    await page.goto('/');
    await expect(page.locator('header')).toBeVisible({ timeout: 10_000 });

    // Switch to dark
    await page.getByRole('tab', { name: 'Settings' }).first().click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    // Verify localStorage was set
    const storedTheme = await page.evaluate(() => localStorage.getItem('theme'));
    expect(storedTheme).toBe('dark');

    // Reload the page (without clearing localStorage)
    await page.reload();
    await expect(page.locator('header')).toBeVisible({ timeout: 10_000 });

    // .dark class should still be present
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('system theme respects prefers-color-scheme', async ({ page }) => {
    // Emulate dark color scheme at OS level
    await page.emulateMedia({ colorScheme: 'dark' });

    await page.goto('/');
    await expect(page.locator('header')).toBeVisible({ timeout: 10_000 });

    // With system theme (default), dark preference should apply .dark
    await expect(page.locator('html')).toHaveClass(/dark/);

    // Switch to light scheme emulation
    await page.emulateMedia({ colorScheme: 'light' });

    // Wait for next-themes to react
    await expect(page.locator('html')).not.toHaveClass(/dark/, { timeout: 3_000 });
  });

  test('no console errors when toggling dark mode', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/');
    await expect(page.locator('header')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('tab', { name: 'Settings' }).first().click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 5_000 });

    // Toggle dark → light → dark
    await page.getByRole('button', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    await page.getByRole('button', { name: 'Light' }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/, { timeout: 3_000 });

    await page.getByRole('button', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    // Filter out known non-critical errors
    const criticalErrors = errors.filter(
      e => !e.includes('403') && !e.includes('net::ERR') && !e.includes('favicon')
        && !e.includes('_spark') && !e.includes('spark')
    );

    expect(criticalErrors).toEqual([]);
  });
});
