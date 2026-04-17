/**
 * Lightweight client-side structured logger for the web app.
 *
 * Mirrors the server schema in `functions/lib/log.ts` so production logs from
 * both tiers share the same shape (operationName, resultType, resultDescription,
 * properties, etc.). Used by web mutations to replace silent
 * `.catch(() => undefined)` swallows.
 *
 * Emits to console.error (warn/error) or console.log (info/debug) so dev tools
 * surface failures and browser-shipping log collectors (Sentry/Datadog/etc.)
 * can pick them up.
 */

export type ClientLogLevel = 'info' | 'warn' | 'error' | 'debug'
export type ClientResultType = 'Succeeded' | 'Failed'

export interface ClientLogFields {
  resultType?: ClientResultType
  resultSignature?: number | string
  resultDescription?: string
  properties?: Record<string, unknown>
}

function emit(level: ClientLogLevel, operationName: string, fields?: ClientLogFields): void {
  const entry: Record<string, unknown> = {
    time: new Date().toISOString(),
    level,
    tier: 'web',
    operationName,
  }
  if (fields?.resultType) entry.resultType = fields.resultType
  if (fields?.resultSignature !== undefined) entry.resultSignature = fields.resultSignature
  if (fields?.resultDescription) entry.resultDescription = fields.resultDescription
  if (fields?.properties && Object.keys(fields.properties).length > 0) entry.properties = fields.properties

  const json = JSON.stringify(entry)
  if (level === 'error' || level === 'warn') {
    console.error(json)
  } else {
    console.log(json)
  }
}

export const clientLog = {
  info: (operationName: string, fields?: ClientLogFields) => emit('info', operationName, fields),
  warn: (operationName: string, fields?: ClientLogFields) => emit('warn', operationName, fields),
  error: (operationName: string, fields?: ClientLogFields) => emit('error', operationName, fields),
  debug: (operationName: string, fields?: ClientLogFields) => emit('debug', operationName, fields),
}

/**
 * Convenience: log a fetch/mutation failure with the error message and
 * (when available) the parsed status code from the thrown Error.
 *
 * Server `apiJson()` throws Error(body || `${status} ${statusText}`). The body
 * is the server-emitted resultDescription, so we surface it directly.
 */
export function logClientFailure(operationName: string, err: unknown, properties?: Record<string, unknown>): void {
  const message = err instanceof Error ? err.message : String(err)
  const statusMatch = /^(\d{3})\s/.exec(message)
  const resultSignature = statusMatch ? Number(statusMatch[1]) : undefined
  clientLog.error(operationName, {
    resultType: 'Failed',
    resultSignature,
    resultDescription: message,
    properties,
  })
}
