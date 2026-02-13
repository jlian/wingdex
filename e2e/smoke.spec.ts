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

    // On desktop (default viewport), nav tabs are in the header
    const header = page.locator('header');
    await expect(header.getByText('Home')).toBeVisible();
    await expect(header.getByText('Outings')).toBeVisible();
    await expect(header.getByText('Life List')).toBeVisible();
    await expect(header.getByText('Settings')).toBeVisible();
  });

  test('can navigate between tabs', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1:has-text("BirdDex")')).toBeVisible({ timeout: 10_000 });

    // Click Outings tab
    await page.getByRole('tab', { name: 'Outings' }).first().click();
    await expect(
      page.getByText('Your Outings').or(page.getByText('No outings yet'))
    ).toBeVisible({ timeout: 5_000 });

    // Click Life List tab
    await page.getByRole('tab', { name: 'Life List' }).first().click();
    await expect(
      page.getByText('Your life list is empty').or(page.getByRole('heading', { name: 'Life List' }))
    ).toBeVisible({ timeout: 5_000 });

    // Click Settings tab
    await page.getByRole('tab', { name: 'Settings' }).first().click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 5_000 });

    // Navigate back to Home
    await page.getByRole('tab', { name: 'Home' }).first().click();
    await expect(page.getByRole('button', { name: 'Add Photos' })).toBeVisible({ timeout: 5_000 });
  });

  test('add photos button opens flow on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await expect(page.locator('h1:has-text("BirdDex")')).toBeVisible({ timeout: 10_000 });

    // The header Add Photos button should be visible
    const addBtn = page.getByRole('button', { name: 'Add Photos' });
    await expect(addBtn).toBeVisible();

    // Click it to open the add photos dialog
    await addBtn.click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
  });

  test('add photos dialog can be closed', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1:has-text("BirdDex")')).toBeVisible({ timeout: 10_000 });

    // Open dialog via header button
    await page.getByRole('button', { name: 'Add Photos' }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    // Close via the X button
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
