export type UserScopedDataBucket =
  | 'photos'
  | 'outings'
  | 'observations'
  | 'dex'
  | 'savedSpots'

export function getUserStoragePrefix(userId: number): string {
  return `u${userId}_`
}

export function getUserStorageKey(userId: number, bucket: UserScopedDataBucket): string {
  return `${getUserStoragePrefix(userId)}${bucket}`
}
