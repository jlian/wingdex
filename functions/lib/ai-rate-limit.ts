import { HttpError } from './http-error'

type AiEndpoint = 'identify-bird'

const DEFAULT_LIMITS: Record<AiEndpoint, number> = {
  'identify-bird': 150,
}

const ENV_LIMIT_KEYS: Record<AiEndpoint, string> = {
  'identify-bird': 'AI_DAILY_LIMIT_IDENTIFY',
}

export class RateLimitError extends HttpError {
  retryAfterSeconds: number

  constructor(message: string, retryAfterSeconds: number) {
    super(429, message)
    this.retryAfterSeconds = retryAfterSeconds
  }
}

function parseLimit(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.floor(parsed))
}

function utcDateKey(now: Date): string {
  return now.toISOString().slice(0, 10)
}

function secondsUntilNextUtcDay(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0)
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000))
}

/** D1-compatible database handle (only the subset we use). */
export interface RateLimitDB {
  prepare(sql: string): { bind(...args: unknown[]): { run(): Promise<{ meta: { changes?: number } }> } }
}

export async function enforceAiDailyLimit(
  db: RateLimitDB,
  userId: string,
  endpoint: AiEndpoint,
  limitOverride?: string,
): Promise<void> {
  const today = utcDateKey(new Date())
  const limit = parseLimit(limitOverride, DEFAULT_LIMITS[endpoint])

  await db.prepare(
    `INSERT INTO ai_daily_usage (userId, endpoint, usageDate, requestCount)
     VALUES (?, ?, ?, 0)
     ON CONFLICT(userId, endpoint, usageDate) DO NOTHING`,
  )
    .bind(userId, endpoint, today)
    .run()

  const increment = await db.prepare(
    `UPDATE ai_daily_usage
       SET requestCount = requestCount + 1,
           updatedAt = datetime('now')
     WHERE userId = ? AND endpoint = ? AND usageDate = ? AND requestCount < ?`,
  )
    .bind(userId, endpoint, today, limit)
    .run()

  if ((increment.meta.changes || 0) > 0) {
    return
  }

  const retryAfterSeconds = secondsUntilNextUtcDay(new Date())
  throw new RateLimitError('Daily AI request limit reached. Please try again tomorrow.', retryAfterSeconds)
}