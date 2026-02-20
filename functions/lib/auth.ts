import { betterAuth } from 'better-auth'
import { anonymous } from 'better-auth/plugins'
import { passkey } from '@better-auth/passkey'
import { Kysely } from 'kysely'
import { D1Dialect } from 'kysely-d1'

type CreateAuthOptions = {
  request?: Request
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1'
}

export function createAuth(env: Env, options: CreateAuthOptions = {}) {
  const database = new Kysely({
    dialect: new D1Dialect({ database: env.DB }),
  })

  const requestOrigin = options.request ? new URL(options.request.url).origin : null
  const requestHostname = options.request ? new URL(options.request.url).hostname : null
  const baseURL = requestHostname && isLocalHostname(requestHostname)
    ? requestOrigin || env.BETTER_AUTH_URL
    : env.BETTER_AUTH_URL
  const useSecureCookies = baseURL.startsWith('https://')

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
