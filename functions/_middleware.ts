import { createAuth } from './lib/auth'
import { verifyTurnstile } from './lib/turnstile'

const TURNSTILE_ACTION = 'anonymous_signin'

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'])

/** Max request body sizes in bytes, keyed by path prefix. */
const BODY_LIMITS: Array<{ prefix: string; maxBytes: number }> = [
  { prefix: '/api/identify-bird', maxBytes: 10 * 1024 * 1024 }, // 10 MB (photos)
  { prefix: '/api/import/', maxBytes: 5 * 1024 * 1024 }, // 5 MB (CSV)
]
const DEFAULT_BODY_LIMIT = 1 * 1024 * 1024 // 1 MB for all other API routes

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
}

/** Append security headers to an existing Response without cloning the body. */
function withSecurityHeaders(response: Response): Response {
  const patched = new Response(response.body, response)
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    patched.headers.set(key, value)
  }
  return patched
}

/** Create an error Response with security headers applied. */
function errorResponse(body: string, status: number, extraHeaders?: Record<string, string>): Response {
  const response = new Response(body, { status })
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value)
  }
  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      response.headers.set(key, value)
    }
  }
  return response
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { pathname, hostname } = new URL(context.request.url)

  // Non-API requests -- pass through with security headers only.
  if (!pathname.startsWith('/api/')) {
    return withSecurityHeaders(await context.next())
  }

  // --- HTTP method validation ---
  if (!ALLOWED_METHODS.has(context.request.method)) {
    return errorResponse('Method Not Allowed', 405, {
      Allow: Array.from(ALLOWED_METHODS).join(', '),
    })
  }

  // --- Request body size limit ---
  const method = context.request.method
  const rawContentLength = context.request.headers.get('content-length')
  const hasBodyMethod = method !== 'GET' && method !== 'OPTIONS'

  if (hasBodyMethod) {
    const parsedLength = rawContentLength === null ? NaN : Number(rawContentLength)
    if (!Number.isFinite(parsedLength) || parsedLength < 0) {
      return errorResponse('Invalid Content-Length', 400)
    }
    if (parsedLength > 0) {
      const limit =
        BODY_LIMITS.find((b) => pathname.startsWith(b.prefix))?.maxBytes ?? DEFAULT_BODY_LIMIT
      if (parsedLength > limit) {
        return errorResponse('Payload Too Large', 413)
      }
    }
  }

  const isLocalRuntime = hostname === 'localhost' || hostname === '127.0.0.1'

  // Require a valid Turnstile token for anonymous sign-in in production.
  // This prevents automated account creation that bypasses AI rate limits.
  if (pathname === '/api/auth/sign-in/anonymous' && !isLocalRuntime) {
    const turnstileSecret = context.env.TURNSTILE_SECRET_KEY?.trim()
    if (!turnstileSecret) {
      return errorResponse('Verification service is unavailable. Please try again later.', 503)
    }

    const rawToken = context.request.headers.get('x-turnstile-token')
    const token = rawToken?.trim()
    if (!token) {
      return errorResponse('Verification required. Please refresh and try again.', 403)
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
      return errorResponse('Verification failed. Please refresh and try again.', 403)
    }
  }

  // Auth routes -- skip session check but still apply security headers.
  if (pathname.startsWith('/api/auth')) {
    return withSecurityHeaders(await context.next())
  }

  const auth = createAuth(context.env, { request: context.request })
  const session = await auth.api.getSession({
    headers: context.request.headers,
  })

  if (!session) {
    return errorResponse('Unauthorized', 401)
  }

  context.data.user = session.user
  context.data.session = session.session

  return withSecurityHeaders(await context.next())
}
