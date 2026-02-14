export type UserScopedDataBucket =
  | 'photos'
  | 'outings'
  | 'observations'
  | 'dex'

// Legacy bucket types that may exist in user's localStorage from older versions
type LegacyUserScopedDataBucket = 'savedSpots'

export function getUserStoragePrefix(userId: number): string {
  return `u${userId}_`
}

export function getUserStorageKey(userId: number, bucket: UserScopedDataBucket | LegacyUserScopedDataBucket): string {
  return `${getUserStoragePrefix(userId)}${bucket}`
}
