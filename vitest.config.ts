import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  define: {
    APP_VERSION: JSON.stringify('test'),
    __GIT_HASH__: JSON.stringify('test'),
    __GIT_BRANCH__: JSON.stringify('test'),
    __DEPLOY_ENV__: JSON.stringify('local'),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    testTimeout: 60000,
  },
})
