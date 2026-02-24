import { describe, expect, it, vi } from 'vitest'
import { waitForPasskeyOwnership } from '../../functions/lib/passkey-ownership'

type Row = { found: number } | null

function createMockDb(rows: Row[]) {
  const first = vi.fn(async () => rows.shift() ?? null)
  const bind = vi.fn(() => ({ first }))
  const prepare = vi.fn(() => ({ bind }))
  return { db: { prepare }, prepare, bind, first }
}

describe('waitForPasskeyOwnership', () => {
  it('returns true when user has at least one passkey', async () => {
    const { db, prepare } = createMockDb([{ found: 1 }])

    const result = await waitForPasskeyOwnership(db, 'user-1')

    expect(result).toBe(true)
    expect(prepare).toHaveBeenCalledWith('SELECT 1 AS found FROM passkey WHERE userId = ? LIMIT 1')
  })

  it('checks a specific passkey id when provided', async () => {
    const { db, bind, prepare } = createMockDb([{ found: 1 }])

    const result = await waitForPasskeyOwnership(db, 'user-1', 'pk-1')

    expect(result).toBe(true)
    expect(prepare).toHaveBeenCalledWith('SELECT 1 AS found FROM passkey WHERE id = ? AND userId = ? LIMIT 1')
    expect(bind).toHaveBeenCalledWith('pk-1', 'user-1')
  })

  it('retries and succeeds when passkey appears shortly after', async () => {
    const { db, first } = createMockDb([null, null, { found: 1 }])

    const result = await waitForPasskeyOwnership(db, 'user-1', undefined, {
      maxAttempts: 3,
      retryDelayMs: 0,
    })

    expect(result).toBe(true)
    expect(first).toHaveBeenCalledTimes(3)
  })

  it('returns false after exhausting retries', async () => {
    const { db, first } = createMockDb([null, null, null])

    const result = await waitForPasskeyOwnership(db, 'user-1', undefined, {
      maxAttempts: 3,
      retryDelayMs: 0,
    })

    expect(result).toBe(false)
    expect(first).toHaveBeenCalledTimes(3)
  })
})
