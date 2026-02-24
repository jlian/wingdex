interface PasskeyLookupRow {
  found: number
}

interface PasskeyLookupDB {
  prepare: (query: string) => {
    bind: (...args: unknown[]) => {
      first: () => Promise<PasskeyLookupRow | null>
    }
  }
}

interface WaitForPasskeyOptions {
  maxAttempts?: number
  retryDelayMs?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function waitForPasskeyOwnership(
  db: PasskeyLookupDB,
  userId: string,
  passkeyId?: string,
  options: WaitForPasskeyOptions = {},
): Promise<boolean> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 150)
  const hasSpecificPasskey = typeof passkeyId === 'string' && passkeyId.trim().length > 0

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const row = hasSpecificPasskey
      ? await db.prepare(
        'SELECT 1 AS found FROM passkey WHERE id = ? AND userId = ? LIMIT 1',
      ).bind(passkeyId!.trim(), userId).first()
      : await db.prepare(
        'SELECT 1 AS found FROM passkey WHERE userId = ? LIMIT 1',
      ).bind(userId).first()

    if (row?.found === 1) {
      return true
    }

    if (attempt < maxAttempts && retryDelayMs > 0) {
      await sleep(retryDelayMs)
    }
  }

  return false
}
