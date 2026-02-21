import { describe, it, expect } from 'vitest'
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
})

describe('RateLimitError', () => {
  it('has 429 status and positive retryAfterSeconds', () => {
    const error = new RateLimitError('limit reached', 3600)
    expect(error.status).toBe(429)
    expect(error.retryAfterSeconds).toBe(3600)
    expect(error.message).toBe('limit reached')
  })
})
