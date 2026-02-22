const DEV_USER_ID_KEY = 'wingdex_dev_user_id'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

interface StableDevUserIdOptions {
  storage?: StorageLike
  seed?: string
  random?: () => number
}

function toPseudoUuid(seed: string, random: () => number): string {
  let hash = 0
  for (let index = 0; index < seed.length; index++) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0
  }

  const fromInt = (value: number) => Math.abs(value).toString(16).padStart(8, '0')
  const rand = () => Math.floor(random() * 0xffffffff)

  const a = fromInt(hash ^ rand())
  const b = fromInt((hash * 17) ^ rand())
  const c = fromInt((hash * 37) ^ rand())
  const d = fromInt((hash * 53) ^ rand())
  const e = fromInt(rand())

  return `${a.slice(0, 8)}-${b.slice(0, 4)}-${b.slice(4, 8)}-${c.slice(0, 4)}-${d}${e.slice(0, 4)}`
}

export function getStableDevUserId(options: StableDevUserIdOptions = {}): string {
  const storage = options.storage ?? window.localStorage
  const seed = options.seed ?? `${window.location.hostname}:${window.location.pathname}`
  const random = options.random ?? Math.random

  try {
    const stored = storage.getItem(DEV_USER_ID_KEY)
    if (stored && stored.length > 0) {
      return stored
    }

    const generated = toPseudoUuid(seed, random)
    storage.setItem(DEV_USER_ID_KEY, generated)
    return generated
  } catch {
    return toPseudoUuid(seed, random)
  }
}
