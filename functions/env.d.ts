interface Env {
  DB: D1Database
  AI: Ai
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
  AI_DAILY_LIMIT_IDENTIFY?: string
  AI_DAILY_LIMIT_SUGGEST?: string
}
