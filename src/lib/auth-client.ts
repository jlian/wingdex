import { createAuthClient } from 'better-auth/react'
import { anonymousClient } from 'better-auth/client/plugins'
import { passkeyClient } from '@better-auth/passkey/client'

export const authClient = createAuthClient({
  plugins: [anonymousClient(), passkeyClient()],
  // socialProviders (github) use the built-in signIn.social() — no client plugin needed
})
