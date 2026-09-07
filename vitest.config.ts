import { defineConfig } from 'vitest/config'

// Keep browser globals and DOM matchers out of pure logic and asset tests.
const domTests = [
  'src/**/*.test.tsx',
  'src/__tests__/account-merge.test.ts',
  'src/__tests__/add-photos-flow.test.ts',
  'src/__tests__/bird-id-probe.test.ts',
  'src/__tests__/current-location.test.ts',
  'src/__tests__/geocoding-client.test.ts',
  'src/__tests__/local-auth-fetch.test.ts',
  'src/__tests__/raw-preview.test.ts',
  'src/__tests__/wikimedia.test.ts',
]

export default defineConfig({
  define: {
    APP_VERSION: JSON.stringify('test'),
    __GIT_HASH__: JSON.stringify('test'),
    __GIT_BRANCH__: JSON.stringify('test'),
  },
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    globals: true,
    pool: 'threads',
    isolate: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'web-node',
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: domTests,
        },
      },
      {
        extends: true,
        test: {
          name: 'web-dom',
          environment: 'jsdom',
          setupFiles: ['./src/__tests__/setup.ts'],
          include: domTests,
        },
      },
      './vitest.functions.config.ts',
    ],
  },
})
