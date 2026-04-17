/**
 * Schematized structured logger for Cloudflare Workers.
 *
 * Emits JSON log lines via console.log/console.error that Cloudflare Workers
 * Logs auto-indexes for the Query Builder. Schema inspired by Azure Monitor
 * resource logs: common envelope + extensible properties bag.
 *
 * Debug-level logs are gated on env.DEBUG.
 */

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'
export type ResultType = 'Succeeded' | 'Failed' | 'InProgress'

export interface LogFields {
  category?: string
  resultType?: ResultType
  resultSignature?: number | string
  /** Human-readable description: context of what was attempted, what happened, and how to fix (for errors). */
  resultDescription?: string
  durationMs?: number
  properties?: Record<string, unknown>
}

export interface Logger {
  info(operationName: string, fields?: LogFields): void
  warn(operationName: string, fields?: LogFields): void
  error(operationName: string, fields?: LogFields): void
  debug(operationName: string, fields?: LogFields): void
  /** Start a timed span. Call `end()` on the result to log with durationMs. */
  time(operationName: string, category?: string): TimedSpan
}

export interface TimedSpan {
  end(fields?: Omit<LogFields, 'durationMs' | 'category'>): void
}

/** Create a logger bound to a specific trace + user context. */
export function createLogger(
  env: { DEBUG?: string },
  traceId: string,
  spanId: string,
  userId?: string,
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
    if (fields?.category) entry.category = fields.category
    if (fields?.resultType) entry.resultType = fields.resultType
    if (fields?.resultSignature !== undefined) entry.resultSignature = fields.resultSignature
    if (fields?.resultDescription) entry.resultDescription = fields.resultDescription
    if (fields?.durationMs !== undefined) entry.durationMs = fields.durationMs
    if (userId) entry.userId = userId
    if (fields?.properties) entry.properties = fields.properties

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
    time(operationName: string, category?: string): TimedSpan {
      const start = Date.now()
      return {
        end(fields) {
          const durationMs = Date.now() - start
          emit('info', operationName, { ...fields, category, durationMs })
        },
      }
    },
  }
}
