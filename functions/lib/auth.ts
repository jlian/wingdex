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
  const baseURL = requestOrigin || env.BETTER_AUTH_URL
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
