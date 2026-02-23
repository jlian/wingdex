import { describe, expect, test } from 'vitest'

import { getStableDevUserId } from '@/lib/dev-user'

function createStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
  }
}

describe('getStableDevUserId', () => {
  test('uses existing persisted ID when valid', () => {
    const storage = createStorage({ wingdex_dev_user_id: '123456789' })
    const id = getStableDevUserId({ storage, seed: 'example', random: () => 0.42 })
    expect(id).toBe('123456789')
  })

  test('generates and persists a stable ID when missing', () => {
    const storage = createStorage()
    const first = getStableDevUserId({ storage, seed: 'example.com:/', random: () => 0.123456 })
    const second = getStableDevUserId({ storage, seed: 'different-seed', random: () => 0.987654 })

    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  test('returns any non-empty persisted value as-is', () => {
    const storage = createStorage({ wingdex_dev_user_id: 'not-a-number' })
    const id = getStableDevUserId({ storage, seed: 'example.com:/birds', random: () => 0.5 })

    expect(id).toBe('not-a-number')
  })
})
