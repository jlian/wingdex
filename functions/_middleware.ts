import { createAuth } from './lib/auth'
import { createLogger } from './lib/log'
import { parseTraceparent, generateTraceContext, childSpanId, formatTraceparent } from './lib/trace-context'

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
  const { pathname } = new URL(context.request.url)

  // Non-API requests -- pass through with security headers only.
  if (!pathname.startsWith('/api/')) {
    return withSecurityHeaders(await context.next())
  }

  // --- Trace context ---
  const incoming = parseTraceparent(context.request.headers.get('traceparent'))
  const traceCtx = incoming
    ? { traceId: incoming.traceId, spanId: childSpanId(), traceFlags: incoming.traceFlags }
    : generateTraceContext()
  const log = createLogger(context.env, traceCtx.traceId, traceCtx.spanId)

  // Store on context.data for route handlers
  context.data.traceId = traceCtx.traceId
  context.data.spanId = traceCtx.spanId
  context.data.log = log

  const method = context.request.method
  const start = Date.now()

  // --- HTTP method validation ---
  if (!ALLOWED_METHODS.has(method)) {
    log.warn('req.rejected', { category: 'Request', resultType: 'Failed', resultSignature: 405, properties: { reason: 'method_not_allowed' } })
    return errorResponse('Method Not Allowed', 405, {
      Allow: Array.from(ALLOWED_METHODS).join(', '),
    })
  }

  // --- Request body size limit ---
  const rawContentLength = context.request.headers.get('content-length')
  const hasBodyMethod = method !== 'GET' && method !== 'OPTIONS'

  if (hasBodyMethod && rawContentLength !== null) {
    const parsedLength = Number(rawContentLength)
    if (!Number.isFinite(parsedLength) || parsedLength < 0) {
      log.warn('req.rejected', { category: 'Request', resultType: 'Failed', resultSignature: 400, properties: { reason: 'invalid_content_length' } })
      return errorResponse('Invalid Content-Length', 400)
    }
    if (parsedLength > 0) {
      const limit =
        BODY_LIMITS.find((b) => pathname.startsWith(b.prefix))?.maxBytes ?? DEFAULT_BODY_LIMIT
      if (parsedLength > limit) {
        log.warn('req.rejected', { category: 'Request', resultType: 'Failed', resultSignature: 413, properties: { reason: 'payload_too_large', limit } })
        return errorResponse('Payload Too Large', 413)
      }
    }
  }

  // Auth routes -- skip session check but still apply security headers + tracing.
  if (pathname.startsWith('/api/auth')) {
    try {
      const response = withSecurityHeaders(await context.next())
      addTraceHeaders(response, traceCtx)
      log.info('req.end', { category: 'Auth', resultType: 'Succeeded', resultSignature: response.status, durationMs: Date.now() - start, properties: { method, path: pathname } })
      return response
    } catch (err) {
      return handleUnexpectedError(err, log, traceCtx, method, pathname, start)
    }
  }

  const auth = createAuth(context.env, { request: context.request })

  const session = await auth.api.getSession({
    headers: context.request.headers,
  })

  if (!session) {
    log.debug('auth.rejected', { category: 'Auth', resultType: 'Failed', resultSignature: 401, properties: { method, path: pathname, bearer: !!context.request.headers.get('authorization') } })
    log.info('req.end', { category: 'Request', resultType: 'Failed', resultSignature: 401, durationMs: Date.now() - start, properties: { method, path: pathname } })
    return errorResponse('Unauthorized', 401)
  }

  context.data.user = session.user
  context.data.session = session.session
  // Re-create logger with userId for downstream logs
  const authedLog = createLogger(context.env, traceCtx.traceId, traceCtx.spanId, session.user.id)
  context.data.log = authedLog

  try {
    const response = withSecurityHeaders(await context.next())
    addTraceHeaders(response, traceCtx)
    authedLog.info('req.end', { category: 'Request', resultType: response.ok ? 'Succeeded' : 'Failed', resultSignature: response.status, durationMs: Date.now() - start, properties: { method, path: pathname } })
    return response
  } catch (err) {
    return handleUnexpectedError(err, authedLog, traceCtx, method, pathname, start)
  }
}

/** Add W3C Trace Context response headers. */
function addTraceHeaders(response: Response, ctx: { traceId: string; spanId: string; traceFlags: string }): void {
  response.headers.set('traceparent', formatTraceparent(ctx))
  response.headers.set('X-Trace-Id', ctx.traceId)
}

/** Catch-all for unhandled errors in route handlers. */
function handleUnexpectedError(
  err: unknown,
  log: ReturnType<typeof createLogger>,
  traceCtx: { traceId: string; spanId: string; traceFlags: string },
  method: string,
  pathname: string,
  start: number,
): Response {
  const message = err instanceof Error ? err.message : String(err)
  const stack = err instanceof Error ? err.stack : undefined
  log.error('req.unhandled', {
    category: 'Request',
    resultType: 'Failed',
    resultSignature: 500,
    durationMs: Date.now() - start,
    properties: { method, path: pathname, error: message, stack },
  })
  const response = errorResponse('Internal Server Error', 500)
  addTraceHeaders(response, traceCtx)
  return response
}
