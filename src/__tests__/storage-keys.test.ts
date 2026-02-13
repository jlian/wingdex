import { describe, expect, test } from 'vitest'

import { getUserStorageKey, getUserStoragePrefix } from '@/lib/storage-keys'

describe('storage keys', () => {
  test('builds a stable user prefix', () => {
    expect(getUserStoragePrefix(42)).toBe('u42_')
  })

  test('builds bucket keys with the existing format', () => {
    expect(getUserStorageKey(42, 'photos')).toBe('u42_photos')
    expect(getUserStorageKey(42, 'outings')).toBe('u42_outings')
    expect(getUserStorageKey(42, 'observations')).toBe('u42_observations')
    expect(getUserStorageKey(42, 'dex')).toBe('u42_dex')
    expect(getUserStorageKey(42, 'savedSpots')).toBe('u42_savedSpots')
  })

  test('keeps keys isolated between different users', () => {
    expect(getUserStorageKey(1, 'photos')).not.toBe(getUserStorageKey(2, 'photos'))
  })
})
