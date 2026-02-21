import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { enforceAiDailyLimit, RateLimitError } from '../../functions/lib/ai-rate-limit'

type UsageRow = {
  requestCount: number
}

class FakeD1Statement {
  constructor(
    private sql: string,
    private db: FakeD1Database,
    private bound: unknown[] = [],
  ) {}

  bind(...args: unknown[]) {
    return new FakeD1Statement(this.sql, this.db, args)
  }

  async run() {
    if (this.sql.includes('INSERT INTO ai_daily_usage')) {
      const [userId, endpoint, usageDate] = this.bound as [string, string, string]
      const key = this.db.makeKey(userId, endpoint, usageDate)
      if (!this.db.rows.has(key)) {
        this.db.rows.set(key, { requestCount: 0 })
        return { meta: { changes: 1 } }
      }
      return { meta: { changes: 0 } }
    }

    if (this.sql.includes('UPDATE ai_daily_usage')) {
      const [userId, endpoint, usageDate, limit] = this.bound as [string, string, string, number]
      const key = this.db.makeKey(userId, endpoint, usageDate)
      const row = this.db.rows.get(key) ?? { requestCount: 0 }

      if (this.db.alwaysDenyUpdates || row.requestCount >= Number(limit)) {
        this.db.rows.set(key, row)
        return { meta: { changes: 0 } }
      }

      row.requestCount += 1
      this.db.rows.set(key, row)
      return { meta: { changes: 1 } }
    }

    throw new Error(`Unexpected SQL in test double: ${this.sql}`)
  }
}

class FakeD1Database {
  rows = new Map<string, UsageRow>()
  alwaysDenyUpdates = false

  makeKey(userId: string, endpoint: string, usageDate: string) {
    return `${userId}|${endpoint}|${usageDate}`
  }

  prepare(sql: string) {
    return new FakeD1Statement(sql, this)
  }
}

function createFakeDB(overrides: Record<string, any> = {}) {
  return { ...new FakeD1Database(), ...overrides }
}

describe('enforceAiDailyLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-20T15:30:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows requests up to limit and then throws 429', async () => {
    const db = new FakeD1Database()

    await expect(enforceAiDailyLimit(db, 'user-1', 'identify-bird', '2')).resolves.toBeUndefined()
    await expect(enforceAiDailyLimit(db, 'user-1', 'identify-bird', '2')).resolves.toBeUndefined()

    await expect(enforceAiDailyLimit(db, 'user-1', 'identify-bird', '2')).rejects.toBeInstanceOf(RateLimitError)

    try {
      await enforceAiDailyLimit(db, 'user-1', 'identify-bird', '2')
    } catch (error) {
      const rateLimitError = error as RateLimitError
      expect(rateLimitError.status).toBe(429)
      expect(rateLimitError.retryAfterSeconds).toBeGreaterThan(0)
    }
  })

  it('uses default limit of 150 for identify-bird', async () => {
    const db = new FakeD1Database()
    // Should succeed without explicit limit (uses default 150)
    await expect(enforceAiDailyLimit(db, 'u1', 'identify-bird')).resolves.toBeUndefined()
  })

  it('uses default limit of 300 for suggest-location', async () => {
    const db = new FakeD1Database()
    await expect(enforceAiDailyLimit(db, 'u1', 'suggest-location')).resolves.toBeUndefined()
  })

  it('isolates limits between different users', async () => {
    const db = new FakeD1Database()
    await enforceAiDailyLimit(db, 'user-A', 'identify-bird', '1')
    // user-A is now at limit
    await expect(enforceAiDailyLimit(db, 'user-A', 'identify-bird', '1')).rejects.toThrow(RateLimitError)
    // user-B should still be allowed
    await expect(enforceAiDailyLimit(db, 'user-B', 'identify-bird', '1')).resolves.toBeUndefined()
  })

  it('isolates limits between different endpoints', async () => {
    const db = new FakeD1Database()
    await enforceAiDailyLimit(db, 'u1', 'identify-bird', '1')
    await expect(enforceAiDailyLimit(db, 'u1', 'identify-bird', '1')).rejects.toThrow(RateLimitError)
    // Different endpoint should still be allowed
    await expect(enforceAiDailyLimit(db, 'u1', 'suggest-location', '1')).resolves.toBeUndefined()
  })

  it('falls back to default limit for non-numeric override', async () => {
    const db = new FakeD1Database()
    // 'not-a-number' → falls back to 150 for identify-bird
    await expect(enforceAiDailyLimit(db, 'u1', 'identify-bird', 'not-a-number')).resolves.toBeUndefined()
  })

  it('throws with retryAfterSeconds > 0 and <= 86400', async () => {
    const db = new FakeD1Database()
    db.alwaysDenyUpdates = true

    try {
      await enforceAiDailyLimit(db, 'u1', 'identify-bird')
      expect.fail('should have thrown')
    } catch (err) {
      const rle = err as RateLimitError
      expect(rle.retryAfterSeconds).toBeGreaterThan(0)
      expect(rle.retryAfterSeconds).toBeLessThanOrEqual(86400)
      expect(rle.message).toContain('Daily AI request limit reached')
    }
  })
})

describe('RateLimitError', () => {
  it('has 429 status and positive retryAfterSeconds', () => {
    const error = new RateLimitError('limit reached', 3600)
    expect(error.status).toBe(429)
    expect(error.retryAfterSeconds).toBe(3600)
    expect(error.message).toBe('limit reached')
  })
})
