import { defineConfig } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  timeout: isCI ? 15_000 : 10_000,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : 4,
  reporter: isCI ? 'line' : 'list',
  use: {
    baseURL: 'http://localhost:5000',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  webServer: {
    command: isCI
      ? 'npx wrangler pages dev dist --port 5000 --show-interactive-dev-session=false'
      : 'npm run dev:full:restart',
    url: 'http://localhost:5000',
    reuseExistingServer: !isCI,
    timeout: isCI ? 45_000 : 20_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
