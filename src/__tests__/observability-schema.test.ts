import { describe, expect, it, vi } from 'vitest'
import { createLogger, operationNameForRequest } from '../../functions/lib/log'

describe('createLogger schema', () => {
  function captureLogs(fn: (log: ReturnType<typeof createLogger>) => void): unknown[] {
    const out: unknown[] = []
    const spyLog = vi.spyOn(console, 'log').mockImplementation((s: string) => { out.push(JSON.parse(s)) })
    const spyErr = vi.spyOn(console, 'error').mockImplementation((s: string) => { out.push(JSON.parse(s)) })
    try {
      const log = createLogger({ DEBUG: '1' }, 'trace123', 'span456', { userId: 'u1', authMethod: 'session' })
      fn(log)
    } finally {
      spyLog.mockRestore()
      spyErr.mockRestore()
    }
    return out
  }

  it('emits the required envelope fields', () => {
    const [entry] = captureLogs(log => log.info('foo.bar', { resultType: 'Succeeded', resultSignature: 200 }))
    expect(entry).toMatchObject({
      level: 'info',
      traceId: 'trace123',
      spanId: 'span456',
      operationName: 'foo.bar',
      resultType: 'Succeeded',
      resultSignature: 200,
      identity: { userId: 'u1', authMethod: 'session' },
    })
    expect(typeof (entry as { time: string }).time).toBe('string')
  })

  it('omits resultDescription, durationMs, properties when absent', () => {
    const [entry] = captureLogs(log => log.info('foo.bar', { resultType: 'Succeeded', resultSignature: 200 }))
    expect(entry).not.toHaveProperty('resultDescription')
    expect(entry).not.toHaveProperty('durationMs')
    expect(entry).not.toHaveProperty('properties')
  })

  it('omits the empty properties bag', () => {
    const [entry] = captureLogs(log => log.info('foo.bar', { resultType: 'Succeeded', resultSignature: 200, properties: {} }))
    expect(entry).not.toHaveProperty('properties')
  })

  it('never emits a category field', () => {
    const [entry] = captureLogs(log => log.info('foo.bar', { resultType: 'Succeeded', resultSignature: 200, properties: { foo: 1 } }))
    expect(entry).not.toHaveProperty('category')
  })

  it('time() emits durationMs', () => {
    const [entry] = captureLogs(log => {
      const span = log.time('foo.timed')
      span.end({ resultType: 'Succeeded', resultSignature: 200 })
    })
    expect(entry).toMatchObject({ operationName: 'foo.timed', resultType: 'Succeeded' })
    expect(typeof (entry as { durationMs: number }).durationMs).toBe('number')
  })

  it('debug logs are gated on DEBUG env', () => {
    const out: unknown[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((s: string) => { out.push(JSON.parse(s)) })
    try {
      const log = createLogger({}, 't', 's')
      log.debug('foo.dbg')
      expect(out).toHaveLength(0)
      const log2 = createLogger({ DEBUG: '1' }, 't', 's')
      log2.debug('foo.dbg')
      expect(out).toHaveLength(1)
    } finally {
      spy.mockRestore()
    }
  })

  it('routes errors to console.error', () => {
    const errs: unknown[] = []
    const spyLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    const spyErr = vi.spyOn(console, 'error').mockImplementation((s: string) => { errs.push(JSON.parse(s)) })
    try {
      const log = createLogger({}, 't', 's')
      log.error('foo.err', { resultType: 'Failed', resultSignature: 500, resultDescription: 'boom' })
    } finally {
      spyLog.mockRestore()
      spyErr.mockRestore()
    }
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ level: 'error', resultDescription: 'boom' })
  })
})

describe('operationNameForRequest', () => {
  it('uppercases method and includes pathname', () => {
    expect(operationNameForRequest('get', '/api/auth/get-session')).toBe('GET /api/auth/get-session')
  })

  it('normalizes outings/:id', () => {
    expect(operationNameForRequest('DELETE', '/api/data/outings/abc-123-def')).toBe('DELETE /api/data/outings/:id')
    expect(operationNameForRequest('GET', '/api/export/outing/xyz')).toBe('GET /api/export/outing/:id')
  })

  it('leaves static auth subpaths unchanged', () => {
    expect(operationNameForRequest('POST', '/api/auth/sign-in/email')).toBe('POST /api/auth/sign-in/email')
  })
})
