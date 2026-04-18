/**
 * Schematized structured logger for Cloudflare Workers.
 *
 * Standard 6-level hierarchy: Trace < Debug < Info < Warning < Error < Critical
 * Controlled by LOG_LEVEL env var (default: Info).
 * Optional LOG_FORMAT=pretty for compact terminal output in local dev.
 *
 * See `docs/OBSERVABILITY.md` for full schema, operationName table, and practices.
 */

export type LogLevel = 'Trace' | 'Debug' | 'Info' | 'Warning' | 'Error' | 'Critical'
export type ResultType = 'Succeeded' | 'Failed'
export type Category = 'Audit' | 'Application' | 'Request'

const LEVEL_RANK: Record<LogLevel, number> = {
  Trace: 0, Debug: 1, Info: 2, Warning: 3, Error: 4, Critical: 5,
}

function parseLogLevel(raw?: string): LogLevel {
  if (!raw) return 'Info'
  const normalized = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()
  if (normalized in LEVEL_RANK) return normalized as LogLevel
  return 'Info'
}

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
  /** Info - significant business events. Production baseline. */
  info(operationName: string, fields?: LogFields): void
  /** Debug - sub-step diagnostic detail. Local dev. */
  debug(operationName: string, fields?: LogFields): void
  /** Trace - ultra-verbose data dumps. Deep debugging only. */
  trace(operationName: string, fields?: LogFields): void
  /** Warning - 4xx, validation failures. Always emitted. */
  warn(operationName: string, fields?: LogFields): void
  /** Error - 5xx, unexpected exceptions. Always emitted. */
  error(operationName: string, fields?: LogFields): void
  /** Returns a child logger with additional properties merged into every log. */
  withResource(extra: Record<string, unknown>): Logger
  /** Returns a child logger with resourceId extended (e.g. 'outings/abc'). */
  withResourceId(segment: string): Logger
}

export interface LoggerContext {
  env: { LOG_LEVEL?: string; LOG_FORMAT?: string; DEBUG?: string }
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
  // Support both LOG_LEVEL and legacy DEBUG (DEBUG=1 maps to Debug level)
  const minLevel = env.LOG_LEVEL
    ? parseLogLevel(env.LOG_LEVEL)
    : env.DEBUG ? 'Debug' : 'Info'
  const minRank = LEVEL_RANK[minLevel]
  const isPretty = env.LOG_FORMAT?.toLowerCase() === 'pretty'

  function emit(level: LogLevel, operationName: string, fields?: LogFields): void {
    if (LEVEL_RANK[level] < minRank) return

    if (isPretty) {
      emitPretty(level, operationName, fields)
    } else {
      emitJson(level, operationName, fields)
    }
  }

  function emitJson(level: LogLevel, operationName: string, fields?: LogFields): void {
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

  function emitPretty(level: LogLevel, operationName: string, fields?: LogFields): void {
    const time = new Date().toLocaleTimeString('en-GB', { hour12: false })
    const lvl = level.toUpperCase().padEnd(8)
    const sig = fields?.resultSignature !== undefined ? ` ${fields.resultSignature}` : ''
    const dur = fields?.durationMs !== undefined ? ` ${fields.durationMs}ms` : ''
    const uid = userId ? ` [${userId.slice(0, 8)}]` : ''
    const desc = fields?.resultDescription ? ` ${fields.resultDescription}` : ''
    const line = `${time} ${lvl} ${operationName}${sig}${dur}${uid}${desc}`

    if (level === 'Error' || level === 'Critical') {
      console.error(line)
    } else {
      console.log(line)
    }
  }

  function makeLogger(currentCtx: LoggerContext): Logger {
    return {
      info: (op, f) => emit('Info', op, f),
      debug: (op, f) => emit('Debug', op, f),
      trace: (op, f) => emit('Trace', op, f),
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
