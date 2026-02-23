import { describe, expect, test } from 'vitest'

import { getUserStorageKey, getUserStoragePrefix } from '@/lib/storage-keys'

describe('storage keys', () => {
  test('builds a stable user prefix', () => {
    expect(getUserStoragePrefix('42')).toBe('42_')
  })

  test('builds bucket keys with the existing format', () => {
    expect(getUserStorageKey('42', 'photos')).toBe('42_photos')
    expect(getUserStorageKey('42', 'outings')).toBe('42_outings')
    expect(getUserStorageKey('42', 'observations')).toBe('42_observations')
    expect(getUserStorageKey('42', 'dex')).toBe('42_dex')
  })

  test('keeps keys isolated between different users', () => {
    expect(getUserStorageKey('1', 'photos')).not.toBe(getUserStorageKey('2', 'photos'))
  })
})
