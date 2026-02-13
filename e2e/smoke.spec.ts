import { test, expect } from '@playwright/test';

test.describe('App smoke tests', () => {
  test('loads without crashing and shows header', async ({ page }) => {
    await page.goto('/');

    // Wait for the app to load past the splash screen
    await expect(page.locator('h1:has-text("BirdDex")')).toBeVisible({ timeout: 10_000 });

    // Header should have the bird icon and title
    const header = page.locator('header');
    await expect(header).toBeVisible();
    await expect(header.locator('text=BirdDex')).toBeVisible();
  });

  test('renders all four nav tabs', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1:has-text("BirdDex")')).toBeVisible({ timeout: 10_000 });

    const nav = page.locator('nav');
    await expect(nav.getByText('Home')).toBeVisible();
    await expect(nav.getByText('Outings')).toBeVisible();
    await expect(nav.getByText('Life List')).toBeVisible();
    await expect(nav.getByText('Settings')).toBeVisible();
  });

  test('can navigate between tabs', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1:has-text("BirdDex")')).toBeVisible({ timeout: 10_000 });

    // Click Outings tab
    await page.getByRole('tab', { name: 'Outings' }).click();
    await expect(
      page.getByText('Your Outings').or(page.getByText('No outings yet'))
    ).toBeVisible({ timeout: 5_000 });

    // Click Life List tab
    await page.getByRole('tab', { name: 'Life List' }).click();
    await expect(
      page.getByText('Your life list is empty').or(page.getByRole('heading', { name: 'Life List' }))
    ).toBeVisible({ timeout: 5_000 });

    // Click Settings tab
    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 5_000 });

    // Navigate back to Home
    await page.getByRole('tab', { name: 'Home' }).click();
    await expect(page.getByText('Upload & Identify').or(page.getByText('Add Photos'))).toBeVisible({ timeout: 5_000 });
  });

  test('FAB button is visible and opens add photos flow', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1:has-text("BirdDex")')).toBeVisible({ timeout: 10_000 });

    // The floating action button should be visible
    const fab = page.locator('button.rounded-full');
    await expect(fab).toBeVisible();

    // Click it to open the add photos dialog
    await fab.click();

    // The dialog title should appear
    await expect(page.getByRole('dialog').getByText('Add Photos').or(page.getByRole('dialog').getByText('Upload'))).toBeVisible({ timeout: 5_000 });
  });

  test('add photos dialog can be closed', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1:has-text("BirdDex")')).toBeVisible({ timeout: 10_000 });

    // Open dialog
    await page.locator('button.rounded-full').click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    // Close via the X button (DialogContent's built-in close, sr-only text "Close")
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 });
  });

  test('no console errors on initial load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/');
    await expect(page.locator('h1:has-text("BirdDex")')).toBeVisible({ timeout: 10_000 });

    // Filter out known non-critical errors (like Spark API 403s)
    const criticalErrors = errors.filter(
      e => !e.includes('403') && !e.includes('net::ERR') && !e.includes('favicon')
    );

    expect(criticalErrors).toEqual([]);
  });

  test('no elements overflow the viewport on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await expect(page.locator('h1:has-text("BirdDex")')).toBeVisible({ timeout: 10_000 });

    // Check no horizontal scrollbar
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth);
  });
});
