import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'functions',
    environment: 'node',
    globals: true,
    pool: 'threads',
    isolate: true,
    include: ['functions/**/*.test.ts'],
  },
})