import { createAuth } from './lib/auth'
import { verifyTurnstile } from './lib/turnstile'

const TURNSTILE_ACTION = 'anonymous_signin'

export const onRequest: PagesFunction<Env> = async (context) => {
  const { pathname, hostname } = new URL(context.request.url)
  const isLocalRuntime = hostname === 'localhost' || hostname === '127.0.0.1'

  // Require a valid Turnstile token for anonymous sign-in in production.
  // This prevents automated account creation that bypasses AI rate limits.
  if (pathname === '/api/auth/sign-in/anonymous' && !isLocalRuntime) {
    const turnstileSecret = context.env.TURNSTILE_SECRET_KEY?.trim()
    if (!turnstileSecret) {
      return new Response('Service temporarily unavailable', { status: 503 })
    }

    const rawToken = context.request.headers.get('x-turnstile-token')
    const token = rawToken?.trim()
    if (!token) {
      return new Response('Forbidden', { status: 403 })
    }

    const ip = context.request.headers.get('cf-connecting-ip')
    const valid = await verifyTurnstile(
      token,
      turnstileSecret,
      ip,
      hostname,
      TURNSTILE_ACTION,
    )
    if (!valid) {
      return new Response('Forbidden', { status: 403 })
    }
  }

  if (!pathname.startsWith('/api/') || pathname.startsWith('/api/auth')) {
    return context.next()
  }

  const auth = createAuth(context.env, { request: context.request })
  const session = await auth.api.getSession({
    headers: context.request.headers,
  })

  if (!session) {
    return new Response('Unauthorized', { status: 401 })
  }

  context.data.user = session.user
  context.data.session = session.session

  return context.next()
}
