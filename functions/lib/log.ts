/**
 * Schematized structured logger for Cloudflare Workers.
 *
 * Emits JSON log lines via console.log/console.error that Cloudflare Workers
 * Logs auto-indexes for the Query Builder.
 *
 * See `.github/AGENTS.md` (Observability) for the full schema, operationName
 * conventions, enrichment pattern, and required practices for new code.
 *
 * Quick reference:
 *   - Request lifecycle log (auto, one per request):
 *       operationName = `<METHOD> <route>`     e.g. `GET /api/auth/get-session`
 *   - Sub-step log (handler/lib emitted):
 *       operationName = `<area>.<step>[.<sub>]` e.g. `birdId.llm.call`
 *   - Drop `category` (always derivable from operationName prefix).
 *   - Omit `resultDescription` on success (the rest of the row already says so).
 *   - To attach context to the request log instead of emitting a duplicate
 *     "did the obvious thing" log, mutate `context.data.requestProperties`.
 *
 * Debug-level logs are gated on env.DEBUG.
 */

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'
export type ResultType = 'Succeeded' | 'Failed'

/** Identity of the caller, inspired by Azure Monitor's identity blob. */
export interface Identity {
  userId?: string
  isAnonymous?: boolean
  authMethod?: 'session' | 'bearer' | 'none'
}

export interface LogFields {
  resultType?: ResultType
  resultSignature?: number | string
  /** Human-readable message: cause + mitigation. Omit on success. */
  resultDescription?: string
  durationMs?: number
  properties?: Record<string, unknown>
}

export interface Logger {
  info(operationName: string, fields?: LogFields): void
  warn(operationName: string, fields?: LogFields): void
  error(operationName: string, fields?: LogFields): void
  debug(operationName: string, fields?: LogFields): void
  /** Start a timed span. Call `.end()` on the result to log with durationMs. */
  time(operationName: string): TimedSpan
}

export interface TimedSpan {
  end(fields?: Omit<LogFields, 'durationMs'>): void
}

/**
 * Build the request-lifecycle operationName: `<METHOD> <normalized route>`.
 * Dynamic ID segments are collapsed to `:id` so cardinality stays bounded.
 * Whitelist-based: only known dynamic-segment parents are normalized.
 */
export function operationNameForRequest(method: string, pathname: string): string {
  const normalized = pathname
    .replace(/^\/api\/data\/outings\/[^/]+/, '/api/data/outings/:id')
    .replace(/^\/api\/export\/outing\/[^/]+/, '/api/export/outing/:id')
  return `${method.toUpperCase()} ${normalized}`
}

/** Create a logger bound to a specific request context. */
export function createLogger(
  env: { DEBUG?: string },
  traceId: string,
  spanId: string,
  identity?: Identity,
): Logger {
  const isDebug = !!env.DEBUG

  function emit(level: LogLevel, operationName: string, fields?: LogFields): void {
    if (level === 'debug' && !isDebug) return

    const entry: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      traceId,
      spanId,
      operationName,
    }
    if (fields?.resultType) entry.resultType = fields.resultType
    if (fields?.resultSignature !== undefined) entry.resultSignature = fields.resultSignature
    if (fields?.resultDescription) entry.resultDescription = fields.resultDescription
    if (fields?.durationMs !== undefined) entry.durationMs = fields.durationMs
    if (identity && (identity.userId || identity.authMethod)) entry.identity = identity
    if (fields?.properties && Object.keys(fields.properties).length > 0) entry.properties = fields.properties

    const json = JSON.stringify(entry)
    if (level === 'error') {
      console.error(json)
    } else {
      console.log(json)
    }
  }

  return {
    info: (op, f) => emit('info', op, f),
    warn: (op, f) => emit('warn', op, f),
    error: (op, f) => emit('error', op, f),
    debug: (op, f) => emit('debug', op, f),
    time(operationName: string): TimedSpan {
      const start = Date.now()
      return {
        end(fields) {
          const durationMs = Date.now() - start
          emit('info', operationName, { ...fields, durationMs })
        },
      }
    },
  }
}
