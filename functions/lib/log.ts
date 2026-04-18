/**
 * Schematized structured logger for Cloudflare Workers.
 *
 * Schema aligned with Azure Monitor resource logs. operationName uses
 * camelCase resource hierarchy: `resourceType/subType/verb`.
 *
 * Level values follow Azure Monitor severity:
 *   Informational - happy-path events (gated on env.DEBUG unless Audit)
 *   Warning       - client errors (4xx), validation failures (always emitted)
 *   Error         - server errors (5xx), unexpected exceptions (always emitted)
 *   Critical      - reserved for data loss, security breach (always emitted)
 *
 * See `docs/OBSERVABILITY.md` for full schema, operationName table,
 * category reference, resourceId hierarchy, and required practices.
 */

export type LogLevel = 'Informational' | 'Warning' | 'Error' | 'Critical'
export type ResultType = 'Succeeded' | 'Failed'
export type Category = 'Audit' | 'Application' | 'Request'

/** Identity of the caller (authMethod + isAnonymous detail). */
export interface Identity {
  isAnonymous?: boolean
  authMethod?: 'session' | 'bearer' | 'none'
}

export interface LogFields {
  category?: Category
  resultType?: ResultType
  resultSignature?: number | string
  /** Human-readable: cause + mitigation. Omit on success. */
  resultDescription?: string
  durationMs?: number
  properties?: Record<string, unknown>
}

export interface Logger {
  /** Informational - gated on DEBUG unless category is Audit. */
  info(operationName: string, fields?: LogFields): void
  /** Warning - always emitted. Use for 4xx, validation failures. */
  warn(operationName: string, fields?: LogFields): void
  /** Error - always emitted. Use for 5xx, unexpected exceptions. */
  error(operationName: string, fields?: LogFields): void
  /** Returns a child logger with additional properties merged into every log. */
  withResource(extra: Record<string, unknown>): Logger
  /** Returns a child logger with resourceId extended (e.g. 'outings/abc'). */
  withResourceId(segment: string): Logger
}

export interface LoggerContext {
  env: { DEBUG?: string }
  traceId: string
  spanId: string
  userId?: string
  identity?: Identity
  resourceId?: string
  baseProperties?: Record<string, unknown>
}

/** Create a logger bound to a specific request context. */
export function createLogger(ctx: LoggerContext): Logger {
  const { env, traceId, spanId, userId, identity, resourceId, baseProperties } = ctx
  const isDebug = !!env.DEBUG

  function emit(level: LogLevel, operationName: string, fields?: LogFields): void {
    // Informational is DEBUG-gated UNLESS category is Audit
    if (level === 'Informational' && !isDebug && fields?.category !== 'Audit') return

    const entry: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      traceId,
      spanId,
      operationName,
    }
    if (fields?.category) entry.category = fields.category
    if (userId) entry.userId = userId
    if (identity) entry.identity = identity
    if (resourceId) entry.resourceId = resourceId
    if (fields?.resultType) entry.resultType = fields.resultType
    if (fields?.resultSignature !== undefined) entry.resultSignature = fields.resultSignature
    if (fields?.resultDescription) entry.resultDescription = fields.resultDescription
    if (fields?.durationMs !== undefined) entry.durationMs = fields.durationMs

    // Merge base properties (from withResource) with per-call properties
    const merged = baseProperties || fields?.properties
      ? { ...baseProperties, ...fields?.properties }
      : undefined
    if (merged && Object.keys(merged).length > 0) entry.properties = merged

    const json = JSON.stringify(entry)
    if (level === 'Error' || level === 'Critical') {
      console.error(json)
    } else {
      console.log(json)
    }
  }

  function makeLogger(currentCtx: LoggerContext): Logger {
    return {
      info: (op, f) => emit('Informational', op, f),
      warn: (op, f) => emit('Warning', op, f),
      error: (op, f) => emit('Error', op, f),
      withResource(extra) {
        return createLogger({
          ...currentCtx,
          baseProperties: { ...currentCtx.baseProperties, ...extra },
        })
      },
      withResourceId(segment) {
        const base = currentCtx.resourceId || ''
        return createLogger({
          ...currentCtx,
          resourceId: `${base}/${segment}`,
        })
      },
    }
  }

  return makeLogger(ctx)
}
