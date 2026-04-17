/**
 * W3C Trace Context (https://www.w3.org/TR/trace-context/) utilities.
 *
 * Generates and parses `traceparent` headers for distributed tracing.
 * Uses crypto.getRandomValues() available in Cloudflare Workers and browsers.
 */

const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/

export interface TraceContext {
  traceId: string
  spanId: string
  traceFlags: string
}

/** Generate 16 random hex characters. */
function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  let hex = ''
  for (let i = 0; i < buf.length; i++) hex += buf[i].toString(16).padStart(2, '0')
  return hex
}

/** Parse a `traceparent` header value. Returns null if invalid. */
export function parseTraceparent(header: string | null): TraceContext | null {
  if (!header) return null
  const m = TRACEPARENT_RE.exec(header.trim())
  if (!m) return null
  const traceId = m[1]
  const spanId = m[2]
  const traceFlags = m[3]
  // All-zero trace-id or span-id are invalid per spec
  if (traceId === '00000000000000000000000000000000') return null
  if (spanId === '0000000000000000') return null
  return { traceId, spanId, traceFlags }
}

/** Generate a fresh trace context (new trace-id + span-id, sampled). */
export function generateTraceContext(): TraceContext {
  return {
    traceId: randomHex(16),
    spanId: randomHex(8),
    traceFlags: '01', // sampled
  }
}

/** Generate a new random span ID (16 hex chars / 8 bytes). */
export function childSpanId(): string {
  return randomHex(8)
}

/** Format a TraceContext into a `traceparent` header value. */
export function formatTraceparent(ctx: TraceContext): string {
  return `00-${ctx.traceId}-${ctx.spanId}-${ctx.traceFlags}`
}
