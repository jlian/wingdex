import { createAuth } from './lib/auth'

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

/** Emit a structured log line for observability. */
function logRequest(method: string, path: string, status: number): void {
  console.log(JSON.stringify({ method, path, status }))
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
  // (Static assets are served by the CDN and skip the Function entirely;
  // only SPA fallback navigations reach here. Skip logging to avoid noise.)
  if (!pathname.startsWith('/api/')) {
    return withSecurityHeaders(await context.next())
  }

  // --- HTTP method validation ---
  if (!ALLOWED_METHODS.has(context.request.method)) {
    logRequest(context.request.method, pathname, 405)
    return errorResponse('Method Not Allowed', 405, {
      Allow: Array.from(ALLOWED_METHODS).join(', '),
    })
  }

  // --- Request body size limit ---
  const method = context.request.method
  const rawContentLength = context.request.headers.get('content-length')
  const hasBodyMethod = method !== 'GET' && method !== 'OPTIONS'

  if (hasBodyMethod && rawContentLength !== null) {
    const parsedLength = Number(rawContentLength)
    if (!Number.isFinite(parsedLength) || parsedLength < 0) {
      logRequest(method, pathname, 400)
      return errorResponse('Invalid Content-Length', 400)
    }
    if (parsedLength > 0) {
      const limit =
        BODY_LIMITS.find((b) => pathname.startsWith(b.prefix))?.maxBytes ?? DEFAULT_BODY_LIMIT
      if (parsedLength > limit) {
        logRequest(method, pathname, 413)
        return errorResponse('Payload Too Large', 413)
      }
    }
  }

  // Auth routes -- skip session check but still apply security headers.
  if (pathname.startsWith('/api/auth')) {
    const response = withSecurityHeaders(await context.next())
    logRequest(context.request.method, pathname, response.status)
    return response
  }

  const auth = createAuth(context.env, { request: context.request })

  // The bearer() plugin enables getSession to accept Authorization: Bearer headers
  // natively, so no cookie translation is needed.
  const session = await auth.api.getSession({
    headers: context.request.headers,
  })

  if (!session) {
    if (context.env.DEBUG) {
      const hasBearer = !!context.request.headers.get('authorization')
      console.log(JSON.stringify({ auth: 'rejected', method: context.request.method, path: pathname, bearer: hasBearer }))
    }
    logRequest(context.request.method, pathname, 401)
    return errorResponse('Unauthorized', 401)
  }

  context.data.user = session.user
  context.data.session = session.session

  const response = withSecurityHeaders(await context.next())
  logRequest(context.request.method, pathname, response.status)
  return response
}
