import { betterAuth } from 'better-auth'
import { anonymous } from 'better-auth/plugins'
import { passkey } from '@better-auth/passkey'
import { Kysely } from 'kysely'
import { D1Dialect } from 'kysely-d1'

export function createAuth(env: Env) {
  const database = new Kysely({
    dialect: new D1Dialect({ database: env.DB }),
  })

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: {
      db: database,
      type: 'sqlite',
    },
    plugins: [
      anonymous(),
      passkey({
        rpName: 'WingDex',
        rpID: new URL(env.BETTER_AUTH_URL).hostname,
        origin: env.BETTER_AUTH_URL,
      }),
    ],
  })
}
