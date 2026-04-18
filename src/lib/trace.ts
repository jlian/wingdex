/** Browser-side W3C Trace Context generation for correlating client requests with server traces. */

/** Generate a traceparent header value per W3C Trace Context spec. */
export function generateTraceparent(): string {
  const buf = new Uint8Array(24) // 16 bytes trace-id + 8 bytes span-id
  crypto.getRandomValues(buf)
  const hex = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
  const traceId = hex.slice(0, 32)
  const spanId = hex.slice(32, 48)
  return `00-${traceId}-${spanId}-01`
}
