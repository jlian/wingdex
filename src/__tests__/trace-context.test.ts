import { describe, expect, it } from 'vitest'
import { parseTraceparent, generateTraceContext, formatTraceparent, childSpanId } from '../../functions/lib/trace-context'

describe('parseTraceparent', () => {
  it('parses a valid traceparent', () => {
    const result = parseTraceparent('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01')
    expect(result).toEqual({
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: 'b7ad6b7169203331',
      traceFlags: '01',
    })
  })

  it('returns null for null input', () => {
    expect(parseTraceparent(null)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseTraceparent('')).toBeNull()
  })

  it('returns null for malformed input', () => {
    expect(parseTraceparent('not-a-traceparent')).toBeNull()
  })

  it('returns null for wrong version', () => {
    expect(parseTraceparent('01-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01')).toBeNull()
  })

  it('returns null for all-zero trace-id', () => {
    expect(parseTraceparent('00-00000000000000000000000000000000-b7ad6b7169203331-01')).toBeNull()
  })

  it('returns null for all-zero span-id', () => {
    expect(parseTraceparent('00-0af7651916cd43dd8448eb211c80319c-0000000000000000-01')).toBeNull()
  })

  it('returns null for too-short trace-id', () => {
    expect(parseTraceparent('00-0af765-b7ad6b7169203331-01')).toBeNull()
  })

  it('returns null for uppercase hex (strict lowercase per spec)', () => {
    expect(parseTraceparent('00-0AF7651916CD43DD8448EB211C80319C-B7AD6B7169203331-01')).toBeNull()
  })

  it('trims whitespace', () => {
    const result = parseTraceparent('  00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01  ')
    expect(result).not.toBeNull()
    expect(result!.traceId).toBe('0af7651916cd43dd8448eb211c80319c')
  })

  it('parses non-sampled trace flags', () => {
    const result = parseTraceparent('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00')
    expect(result).not.toBeNull()
    expect(result!.traceFlags).toBe('00')
  })
})

describe('generateTraceContext', () => {
  it('returns valid trace-id (32 hex chars)', () => {
    const ctx = generateTraceContext()
    expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/)
  })

  it('returns valid span-id (16 hex chars)', () => {
    const ctx = generateTraceContext()
    expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/)
  })

  it('sets traceFlags to 01 (sampled)', () => {
    expect(generateTraceContext().traceFlags).toBe('01')
  })

  it('generates unique trace-ids', () => {
    const ids = new Set(Array.from({ length: 10 }, () => generateTraceContext().traceId))
    expect(ids.size).toBe(10)
  })

  it('does not produce all-zero trace-id', () => {
    // Extremely unlikely with crypto.getRandomValues but verify the format
    const ctx = generateTraceContext()
    expect(ctx.traceId).not.toBe('00000000000000000000000000000000')
  })
})

describe('childSpanId', () => {
  it('returns 16 hex chars', () => {
    expect(childSpanId()).toMatch(/^[0-9a-f]{16}$/)
  })

  it('generates unique span-ids', () => {
    const ids = new Set(Array.from({ length: 10 }, () => childSpanId()))
    expect(ids.size).toBe(10)
  })
})

describe('formatTraceparent', () => {
  it('formats a valid traceparent string', () => {
    const result = formatTraceparent({
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: 'b7ad6b7169203331',
      traceFlags: '01',
    })
    expect(result).toBe('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01')
  })

  it('round-trips through parse', () => {
    const original = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'
    const parsed = parseTraceparent(original)!
    expect(formatTraceparent(parsed)).toBe(original)
  })

  it('round-trips generated context', () => {
    const ctx = generateTraceContext()
    const formatted = formatTraceparent(ctx)
    const parsed = parseTraceparent(formatted)
    expect(parsed).toEqual(ctx)
  })
})
