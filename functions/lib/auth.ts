import { betterAuth } from 'better-auth'
import { anonymous } from 'better-auth/plugins'
import { passkey } from '@better-auth/passkey'
import { Kysely } from 'kysely'
import { D1Dialect } from 'kysely-d1'

type CreateAuthOptions = {
  request?: Request
}

export function createAuth(env: Env, options: CreateAuthOptions = {}) {
  const database = new Kysely({
    dialect: new D1Dialect({ database: env.DB }),
  })

  const requestOrigin = options.request ? new URL(options.request.url).origin : null
  const headerOrigin = options.request?.headers.get('origin') || null
  const baseURL = headerOrigin || env.BETTER_AUTH_URL || requestOrigin
  const useSecureCookies = baseURL.startsWith('https://')

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
        rpID: new URL(baseURL).hostname,
        origin: baseURL,
      }),
    ],
  })
}
