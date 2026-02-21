import { describe, it, expect } from 'vitest'
import { createAuth } from '../../functions/lib/auth'

const mockEnv = {
  DB: {} as D1Database,
  AI: {} as Ai,
  BETTER_AUTH_URL: 'http://localhost:5000',
  BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long!!',
  GITHUB_CLIENT_ID: 'test-github-id',
  GITHUB_CLIENT_SECRET: 'test-github-secret',
  APPLE_CLIENT_ID: '',
  APPLE_CLIENT_SECRET: '',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  LLM_PROVIDER: '',
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
} satisfies Env

describe('auth config', () => {
  it('creates auth with GitHub social provider', () => {
    const auth = createAuth(mockEnv)
    // Better Auth exposes social sign-in as API methods; verify GitHub callback exists
    expect(auth.api).toBeDefined()
    expect(auth.api.callbackOAuth).toBeDefined()
    expect(auth.api.signInSocial).toBeDefined()
  })

  it('exposes account linking options', () => {
    const auth = createAuth(mockEnv)
    expect(auth.options.account?.accountLinking?.enabled).toBe(true)
    expect(auth.options.account?.accountLinking?.trustedProviders).toContain(
      'github',
    )
    expect(auth.options.account?.accountLinking?.allowDifferentEmails).toBe(true)
  })

  it('includes passkey and anonymous plugins', () => {
    const auth = createAuth(mockEnv)
    const apiKeys = Object.keys(auth.api)
    // Passkey plugin registers passkey-related endpoints
    expect(apiKeys.some((k) => k.toLowerCase().includes('passkey'))).toBe(true)
    // Anonymous plugin adds signInAnonymous
    expect(apiKeys.some((k) => k.toLowerCase().includes('anonymous'))).toBe(true)
  })

  it('routes GitHub callback through handler', async () => {
    const auth = createAuth(mockEnv)
    // Verify GitHub callback endpoint responds (not 404)
    const req = new Request('http://localhost:5000/api/auth/callback/github')
    const res = await auth.handler(req)
    // Should not be 404 — a redirect or error from missing OAuth state is expected
    expect(res.status).not.toBe(404)
  })
})
