interface Env {
  DB: D1Database
  AI: Ai
  RANGE_PRIORS: R2Bucket
  BETTER_AUTH_URL: string
  BETTER_AUTH_SECRET: string
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  APPLE_CLIENT_ID: string
  APPLE_CLIENT_SECRET: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  CF_ACCOUNT_ID: string
  AI_GATEWAY_ID: string
  CF_AIG_TOKEN: string
  OPENAI_API_KEY: string
  OPENAI_MODEL: string
  OPENAI_MODEL_STRONG?: string
  AI_DAILY_LIMIT_IDENTIFY?: string
  AI_DAILY_LIMIT_SUGGEST?: string
  TRUSTED_ORIGINS?: string
  /** @deprecated Use LOG_LEVEL instead. Kept for backwards compat (DEBUG=1 maps to LOG_LEVEL=debug). */
  DEBUG?: string
  /** Log level: trace, debug, info (default), warn/warning, error, critical. */
  LOG_LEVEL?: string
  /** Log format: 'pretty' for compact terminal output, omit for JSON. */
  LOG_FORMAT?: string
}

/** Shape of context.data populated by _middleware.ts. */
interface RequestData extends Record<string, unknown> {
  user?: { id?: string; isAnonymous?: boolean }
  session?: { id: string }
  traceId?: string
  spanId?: string
  log?: import('./lib/log').Logger
  operationName?: string
  category?: import('./lib/log').Category
}
