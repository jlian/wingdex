import { describe, it, expect } from 'vitest'
import { enforceAiDailyLimit, RateLimitError } from '../../functions/lib/ai-rate-limit'
import { onRequestPost as identifyBirdPost } from '../../functions/api/identify-bird'

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

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: new FakeD1Database() as unknown as D1Database,
    AI: {} as Ai,
    BETTER_AUTH_URL: '',
    BETTER_AUTH_SECRET: '',
    GITHUB_CLIENT_ID: '',
    GITHUB_CLIENT_SECRET: '',
    APPLE_CLIENT_ID: '',
    APPLE_CLIENT_SECRET: '',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    LLM_PROVIDER: 'openai',
    OPENAI_API_KEY: '',
    OPENAI_MODEL: '',
    AZURE_OPENAI_ENDPOINT: '',
    AZURE_OPENAI_API_KEY: '',
    AZURE_OPENAI_DEPLOYMENT: '',
    AZURE_OPENAI_API_VERSION: '',
    GITHUB_MODELS_TOKEN: '',
    GITHUB_MODELS_ENDPOINT: '',
    GITHUB_MODELS_MODEL: '',
    CF_ACCOUNT_ID: '',
    AI_GATEWAY_ID: '',
    ...overrides,
  }
}

describe('enforceAiDailyLimit', () => {
  it('allows requests up to limit and then throws 429', async () => {
    const env = createEnv({ AI_DAILY_LIMIT_IDENTIFY: '2' })

    await expect(enforceAiDailyLimit(env, 'user-1', 'identify-bird')).resolves.toBeUndefined()
    await expect(enforceAiDailyLimit(env, 'user-1', 'identify-bird')).resolves.toBeUndefined()

    await expect(enforceAiDailyLimit(env, 'user-1', 'identify-bird')).rejects.toBeInstanceOf(RateLimitError)

    try {
      await enforceAiDailyLimit(env, 'user-1', 'identify-bird')
    } catch (error) {
      const rateLimitError = error as RateLimitError
      expect(rateLimitError.status).toBe(429)
      expect(rateLimitError.retryAfterSeconds).toBeGreaterThan(0)
    }
  })
})

describe('identify-bird endpoint rate limiting', () => {
  it('returns 429 and Retry-After header when daily limit is reached', async () => {
    const db = new FakeD1Database()
    db.alwaysDenyUpdates = true

    const response = await identifyBirdPost({
      request: new Request('http://localhost/api/identify-bird', { method: 'POST' }),
      env: createEnv({ DB: db as unknown as D1Database }),
      data: { user: { id: 'user-2' } },
    } as unknown as Parameters<typeof identifyBirdPost>[0])

    expect(response.status).toBe(429)
    expect(await response.text()).toContain('Daily AI request limit reached')
    const retryAfter = response.headers.get('Retry-After')
    expect(retryAfter).toBeTruthy()
    expect(Number(retryAfter)).toBeGreaterThan(0)
  })
})
