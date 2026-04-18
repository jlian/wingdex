import { describe, expect, it, vi } from 'vitest'
import { createLogger } from '../../functions/lib/log'

describe('createLogger schema', () => {
  function captureLogs(fn: (log: ReturnType<typeof createLogger>) => void, logLevel = 'debug'): unknown[] {
    const out: unknown[] = []
    const spyLog = vi.spyOn(console, 'log').mockImplementation((s: string) => { out.push(JSON.parse(s)) })
    const spyErr = vi.spyOn(console, 'error').mockImplementation((s: string) => { out.push(JSON.parse(s)) })
    try {
      const log = createLogger({ env: { LOG_LEVEL: logLevel }, traceId: 'trace123', spanId: 'span456', userId: 'u1', identity: { authMethod: 'session' } })
      fn(log)
    } finally {
      spyLog.mockRestore()
      spyErr.mockRestore()
    }
    return out
  }

  it('emits the required envelope fields', () => {
    const [entry] = captureLogs(log => log.info('foo/bar/read', { category: 'Application', resultType: 'Succeeded', resultSignature: 200 }))
    expect(entry).toMatchObject({
      level: 'Info',
      traceId: 'trace123',
      spanId: 'span456',
      operationName: 'foo/bar/read',
      category: 'Application',
      userId: 'u1',
      resultType: 'Succeeded',
      resultSignature: 200,
      identity: { authMethod: 'session' },
    })
    expect(typeof (entry as { time: string }).time).toBe('string')
  })

  it('omits resultDescription, durationMs, properties when absent', () => {
    const [entry] = captureLogs(log => log.info('foo/bar/read', { category: 'Application', resultType: 'Succeeded', resultSignature: 200 }))
    expect(entry).not.toHaveProperty('resultDescription')
    expect(entry).not.toHaveProperty('durationMs')
    expect(entry).not.toHaveProperty('properties')
  })

  it('omits the empty properties bag', () => {
    const [entry] = captureLogs(log => log.info('foo/bar/read', { category: 'Application', resultType: 'Succeeded', resultSignature: 200, properties: {} }))
    expect(entry).not.toHaveProperty('properties')
  })

  it('Info is emitted at info level (production default)', () => {
    const out = captureLogs(log => log.info('foo/bar/read'), 'info')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ level: 'Info' })
  })

  it('Debug is gated - not emitted at info level', () => {
    const out = captureLogs(log => log.debug('foo/bar/read'), 'info')
    expect(out).toHaveLength(0)
  })

  it('Debug is emitted at debug level', () => {
    const out = captureLogs(log => log.debug('foo/bar/read'), 'debug')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ level: 'Debug' })
  })

  it('Trace is gated - not emitted at debug level', () => {
    const out = captureLogs(log => log.trace('foo/bar/read'), 'debug')
    expect(out).toHaveLength(0)
  })

  it('Trace is emitted at trace level', () => {
    const out = captureLogs(log => log.trace('foo/bar/read'), 'trace')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ level: 'Trace' })
  })

  it('Warning and Error always emit even at info level', () => {
    const out = captureLogs(log => {
      log.warn('foo/bar/read', { category: 'Application' })
      log.error('foo/bar/read', { category: 'Application' })
    }, 'info')
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ level: 'Warning' })
    expect(out[1]).toMatchObject({ level: 'Error' })
  })

  it('routes errors to console.error', () => {
    const errs: unknown[] = []
    const spyLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    const spyErr = vi.spyOn(console, 'error').mockImplementation((s: string) => { errs.push(JSON.parse(s)) })
    try {
      const log = createLogger({ env: {}, traceId: 't', spanId: 's' })
      log.error('foo/bar/read', { category: 'Application', resultType: 'Failed', resultSignature: 500, resultDescription: 'boom' })
    } finally {
      spyLog.mockRestore()
      spyErr.mockRestore()
    }
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ level: 'Error', resultDescription: 'boom' })
  })

  it('legacy DEBUG=1 maps to debug level', () => {
    const out: unknown[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((s: string) => { out.push(JSON.parse(s)) })
    try {
      const log = createLogger({ env: { DEBUG: '1' }, traceId: 't', spanId: 's' })
      log.debug('foo/bar/read')
      expect(out).toHaveLength(1)
    } finally {
      spy.mockRestore()
    }
  })

  it('withResource merges properties into all subsequent logs', () => {
    const [entry] = captureLogs(log => {
      const scoped = log.withResource({ outingId: 'outing_abc' })
      scoped.info('data/outings/write', { category: 'Application', properties: { locationName: 'Park' } })
    })
    expect(entry).toMatchObject({ properties: { outingId: 'outing_abc', locationName: 'Park' } })
  })

  it('withResourceId extends the resourceId path', () => {
    const out: unknown[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((s: string) => { out.push(JSON.parse(s)) })
    try {
      const log = createLogger({ env: { LOG_LEVEL: 'debug' }, traceId: 't', spanId: 's', resourceId: '/users/u1' })
      const scoped = log.withResourceId('outings/abc')
      scoped.info('data/outings/delete', { category: 'Application' })
    } finally {
      spy.mockRestore()
    }
    expect(out[0]).toMatchObject({ resourceId: '/users/u1/outings/abc' })
  })

  it('pretty format emits one-liner to console', () => {
    const out: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((s: string) => { out.push(s) })
    try {
      const log = createLogger({ env: { LOG_LEVEL: 'debug', LOG_FORMAT: 'pretty' }, traceId: 't', spanId: 's', userId: 'u1' })
      log.info('data/all/read', { resultSignature: 200, durationMs: 42, resultDescription: 'Fetched 5 outings' })
    } finally {
      spy.mockRestore()
    }
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('INFO')
    expect(out[0]).toContain('data/all/read')
    expect(out[0]).toContain('200')
    expect(out[0]).toContain('42ms')
    expect(out[0]).toContain('Fetched 5 outings')
    // Should NOT be JSON
    expect(out[0]).not.toContain('{')
  })
})
