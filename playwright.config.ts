import { defineConfig } from '@playwright/test'
import { testBaseURL } from './e2e/test-server'

const isCI = !!process.env.CI
const live = process.env.PLAYWRIGHT_LIVE === 'true'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  timeout: 15_000,
  retries: 0,
  // This has repeatedly reverted from two to one: concurrent browsers contend
  // with the shared Worker/D1. Keep one worker; serve built assets instead of
  // paying Vite's module graph and HMR cost on every navigation. CI shards
  // instead use separate VMs, each with its own Worker and database.
  workers: 1,
  reporter: isCI ? 'line' : 'list',
  grep: live ? /@live|@remote-r2/ : undefined,
  grepInvert: live ? undefined : /@live|@remote-r2/,
  use: {
    baseURL: testBaseURL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node e2e/start-server.mjs',
    url: `${testBaseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
