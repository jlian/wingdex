import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5000',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev:full',
    url: 'http://127.0.0.1:5000',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
