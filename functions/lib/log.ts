/**
 * Schematized structured logger for Cloudflare Workers.
 *
 * Emits JSON log lines via console.log/console.error that Cloudflare Workers
 * Logs auto-indexes for the Query Builder. Schema inspired by Azure Monitor
 * resource logs: common envelope + extensible properties bag.
 *
 * operationName conventions (Azure Monitor inspired; we don't strictly mirror
 * Azure Resource Manager syntax):
 *   - Request lifecycle (auto, emitted by middleware):  `<pathname>/<Action>`
 *     e.g. `/api/auth/get-session/Read`, `/api/data/observations/Write`
 *   - Per-route sub-operations (semantic):              `WingDex/<Resource>/<Sub>/<Action>`
 *     e.g. `WingDex/Data/Observations/Write`, `WingDex/BirdId/RangeFilter/Action`
 *   `<Action>` is one of `Read | Write | Delete | Action` (HTTP method maps via
 *   `methodToAction`). Path/method are intentionally NOT separate envelope
 *   fields - they're folded into operationName so queries pivot on a single
 *   dimension.
 *
 * Debug-level logs are gated on env.DEBUG.
 *
 * See `.github/AGENTS.md` (Observability) for full conventions and rationale.
 */

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'
export type ResultType = 'Succeeded' | 'Failed' | 'InProgress'

/** Identity of the caller, inspired by Azure Monitor's identity blob. */
export interface Identity {
  userId?: string
  isAnonymous?: boolean
  authMethod?: 'session' | 'bearer' | 'none'
}

export interface LogFields {
  category?: string
  resultType?: ResultType
  resultSignature?: number | string
  /** Human-readable description: context, what happened, mitigation. Omit when redundant with other fields. */
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

/** Map an HTTP method to its operationName action suffix. */
export function methodToAction(method: string): 'Read' | 'Write' | 'Delete' | 'Action' {
  switch (method.toUpperCase()) {
    case 'GET':
    case 'HEAD':
    case 'OPTIONS':
      return 'Read'
    case 'POST':
    case 'PUT':
    case 'PATCH':
      return 'Write'
    case 'DELETE':
      return 'Delete'
    default:
      return 'Action'
  }
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
    if (fields?.category) entry.category = fields.category
    if (fields?.resultType) entry.resultType = fields.resultType
    if (fields?.resultSignature !== undefined) entry.resultSignature = fields.resultSignature
    if (fields?.resultDescription) entry.resultDescription = fields.resultDescription
    if (fields?.durationMs !== undefined) entry.durationMs = fields.durationMs
    if (identity?.userId) entry.identity = identity
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
