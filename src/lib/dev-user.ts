const DEV_USER_ID_KEY = 'wingdex_dev_user_id'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

interface StableDevUserIdOptions {
  storage?: StorageLike
  seed?: string
  random?: () => number
}

export function getStableDevUserId(options: StableDevUserIdOptions = {}): number {
  const storage = options.storage ?? window.localStorage
  const seed = options.seed ?? `${window.location.hostname}:${window.location.pathname}`
  const random = options.random ?? Math.random

  try {
    const stored = storage.getItem(DEV_USER_ID_KEY)
    const parsed = stored ? Number.parseInt(stored, 10) : Number.NaN
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed
    }

    let hash = 0
    for (let index = 0; index < seed.length; index++) {
      hash = (hash * 31 + seed.charCodeAt(index)) | 0
    }

    const randomPart = Math.floor(random() * 1_000_000)
    const generated = (Math.abs(hash * 31 + randomPart) % 900_000_000) + 100_000_000
    storage.setItem(DEV_USER_ID_KEY, String(generated))
    return generated
  } catch {
    return Math.floor(random() * 900_000_000) + 100_000_000
  }
}
