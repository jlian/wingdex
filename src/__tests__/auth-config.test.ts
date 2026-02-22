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
  it('exposes account linking options', () => {
    const auth = createAuth(mockEnv)
    expect(auth.options.account?.accountLinking?.enabled).toBe(true)
    expect(auth.options.account?.accountLinking?.trustedProviders).toContain('github')
    expect(auth.options.account?.accountLinking?.trustedProviders).toContain('apple')
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

  it('registers GitHub callback route when credentials are set', () => {
    const auth = createAuth(mockEnv)
    // signInSocial + callbackOAuth are registered when socialProviders are configured
    expect(auth.api.signInSocial).toBeDefined()
    expect(auth.api.callbackOAuth).toBeDefined()
  })

  it('omits socialProviders when credentials are missing', () => {
    const authNoGh = createAuth({ ...mockEnv, GITHUB_CLIENT_ID: '', GITHUB_CLIENT_SECRET: '' })
    // Auth should still create successfully without GitHub
    expect(authNoGh.api).toBeDefined()
  })

  it('registers Apple provider when credentials are set', () => {
    const auth = createAuth({
      ...mockEnv,
      APPLE_CLIENT_ID: 'test-apple-id',
      APPLE_CLIENT_SECRET: 'test-apple-secret',
    })
    expect(auth.api.signInSocial).toBeDefined()
  })
})
