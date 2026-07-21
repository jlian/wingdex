export type UserScopedDataBucket =
  | 'photos'
  | 'outings'
  | 'observations'
  | 'dex'

// Legacy bucket types that may exist in user's localStorage from older versions
type LegacyUserScopedDataBucket = 'savedSpots'

export function getUserStoragePrefix(userId: string): string {
  return `${userId}_`
}

export function getUserStorageKey(userId: string, bucket: UserScopedDataBucket | LegacyUserScopedDataBucket): string {
  return `${getUserStoragePrefix(userId)}${bucket}`
}

/**
 * Feature flag: on-device (BioCLIP) bird identification.
 *
 * Off by default. When enabled, the model router uses on-device inference once
 * the ~307 MB model is cached, otherwise it falls back to the server (GPT) and
 * prefetches the model in the background. Stored globally (not user-scoped)
 * since it reflects a device/bandwidth choice.
 */
const ON_DEVICE_ID_KEY = 'wingdex.onDeviceId'

export function isOnDeviceEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(ON_DEVICE_ID_KEY) === 'true'
  } catch {
    return false
  }
}

export function setOnDeviceEnabled(enabled: boolean): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(ON_DEVICE_ID_KEY, enabled ? 'true' : 'false')
  } catch {
    /* ignore */
  }
}
