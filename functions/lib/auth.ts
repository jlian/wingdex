import { betterAuth } from 'better-auth'
import { anonymous } from 'better-auth/plugins'
import { passkey } from '@better-auth/passkey'
import { Kysely } from 'kysely'
import { D1Dialect } from 'kysely-d1'

type CreateAuthOptions = {
  request?: Request
}

const AUTH_DEBUG_LOGGED_KEY = '__wingdexAuthDebugLogged__'

export function createAuth(env: Env, options: CreateAuthOptions = {}) {
  const database = new Kysely({
    dialect: new D1Dialect({ database: env.DB }),
  })

  const requestOrigin = options.request ? new URL(options.request.url).origin : null
  const headerOrigin = options.request?.headers.get('origin') || null

  const isLoopbackOrigin = (value: string | null): value is string => {
    if (!value) return false
    const { hostname } = new URL(value)
    return hostname === 'localhost' || hostname === '127.0.0.1'
  }

  const inferredLocalAppOrigin = (() => {
    if (!requestOrigin) return null
    const requestUrl = new URL(requestOrigin)
    const isWranglerApiOrigin = isLoopbackOrigin(requestOrigin) && requestUrl.port === '8788'
    if (!isWranglerApiOrigin) return null

    if (headerOrigin && isLoopbackOrigin(headerOrigin)) {
      return headerOrigin
    }

    return `${requestUrl.protocol}//${requestUrl.hostname}:5000`
  })()

  // Single source of truth for public app origin:
  // 1) explicit env override, 2) local two-port mapping, 3) request origin.
  const baseURL = env.BETTER_AUTH_URL || inferredLocalAppOrigin || requestOrigin
  if (!baseURL) throw new Error('Unable to determine a valid base URL for authentication')

  const useSecureCookies = baseURL.startsWith('https://')
  const trustedOrigins = new Set<string>([baseURL])
  if (requestOrigin) trustedOrigins.add(requestOrigin)
  if (headerOrigin && isLoopbackOrigin(headerOrigin)) trustedOrigins.add(headerOrigin)
  // Allow extra trusted origins via env (e.g. LAN dev with custom domain + TLS)
  if (env.TRUSTED_ORIGINS) {
    for (const o of env.TRUSTED_ORIGINS.split(',')) {
      const trimmed = o.trim()
      if (trimmed) trustedOrigins.add(trimmed)
    }
  }
  // Apple Sign-In uses form_post: Apple's server POSTs to our callback with
  // Origin: https://appleid.apple.com, so we must trust it when Apple is configured.
  if (env.APPLE_CLIENT_ID) trustedOrigins.add('https://appleid.apple.com')

  const passkeyOrigin = (() => {
    // When accessing via a trusted LAN origin (e.g. custom domain with TLS),
    // use it for passkey RP ID so WebAuthn works on that domain.
    if (headerOrigin && !isLoopbackOrigin(headerOrigin) && trustedOrigins.has(headerOrigin)) {
      return headerOrigin
    }
    // Infer from Referer when Origin header is absent (e.g. GET requests)
    const referer = options.request?.headers.get('referer')
    if (referer) {
      const refererOrigin = new URL(referer).origin
      if (!isLoopbackOrigin(refererOrigin) && trustedOrigins.has(refererOrigin)) {
        return refererOrigin
      }
    }
    return baseURL
  })()

  if (isLoopbackOrigin(baseURL)) {
    const globalRef = globalThis as typeof globalThis & Record<string, unknown>
    if (globalRef[AUTH_DEBUG_LOGGED_KEY] !== true) {
      globalRef[AUTH_DEBUG_LOGGED_KEY] = true
      console.info('[auth:dev] resolved origins', {
        baseURL,
        requestOrigin,
        headerOrigin,
        passkeyOrigin,
        trustedOrigins: Array.from(trustedOrigins),
      })
    }
  }

  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {}
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    socialProviders.github = { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
  }
  if (env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET) {
    socialProviders.apple = { clientId: env.APPLE_CLIENT_ID, clientSecret: env.APPLE_CLIENT_SECRET }
  }

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL,
    trustedOrigins: Array.from(trustedOrigins),
    database: {
      db: database,
      type: 'sqlite',
    },
    advanced: {
      useSecureCookies,
    },
    ...(Object.keys(socialProviders).length > 0 ? { socialProviders } : {}),
    user: {
      deleteUser: {
        enabled: true,
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ['github', 'apple'],
        allowDifferentEmails: true,
      },
    },
    plugins: [
      anonymous(),
      passkey({
        rpName: 'WingDex',
        rpID: new URL(passkeyOrigin).hostname,
        origin: passkeyOrigin,
      }),
    ],
  })
}
