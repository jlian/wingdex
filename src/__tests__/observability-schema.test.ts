import { describe, expect, it, vi } from 'vitest'
import { createLogger } from '../../functions/lib/log'

describe('createLogger schema', () => {
  function captureLogs(fn: (log: ReturnType<typeof createLogger>) => void): unknown[] {
    const out: unknown[] = []
    const spyLog = vi.spyOn(console, 'log').mockImplementation((s: string) => { out.push(JSON.parse(s)) })
    const spyErr = vi.spyOn(console, 'error').mockImplementation((s: string) => { out.push(JSON.parse(s)) })
    try {
      const log = createLogger({ env: { DEBUG: '1' }, traceId: 'trace123', spanId: 'span456', userId: 'u1', identity: { authMethod: 'session' } })
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
      level: 'Informational',
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

  it('includes category when provided', () => {
    const [entry] = captureLogs(log => log.info('foo/bar/read', { category: 'Audit', resultType: 'Succeeded', resultSignature: 200 }))
    expect(entry).toMatchObject({ category: 'Audit' })
  })

  it('Informational logs are gated on DEBUG env', () => {
    const out: unknown[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((s: string) => { out.push(JSON.parse(s)) })
    try {
      const log = createLogger({ env: {}, traceId: 't', spanId: 's' })
      log.info('foo/bar/read')
      expect(out).toHaveLength(0)
      const log2 = createLogger({ env: { DEBUG: '1' }, traceId: 't', spanId: 's' })
      log2.info('foo/bar/read')
      expect(out).toHaveLength(1)
    } finally {
      spy.mockRestore()
    }
  })

  it('Audit category bypasses DEBUG gate', () => {
    const out: unknown[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((s: string) => { out.push(JSON.parse(s)) })
    try {
      const log = createLogger({ env: {}, traceId: 't', spanId: 's' })
      log.info('data/clear/delete', { category: 'Audit' })
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
      const log = createLogger({ env: {}, traceId: 't', spanId: 's' })
      log.error('foo/bar/read', { category: 'Application', resultType: 'Failed', resultSignature: 500, resultDescription: 'boom' })
    } finally {
      spyLog.mockRestore()
      spyErr.mockRestore()
    }
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ level: 'Error', resultDescription: 'boom' })
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
      const log = createLogger({ env: { DEBUG: '1' }, traceId: 't', spanId: 's', resourceId: '/users/u1' })
      const scoped = log.withResourceId('outings/abc')
      scoped.info('data/outings/delete', { category: 'Application' })
    } finally {
      spy.mockRestore()
    }
    expect(out[0]).toMatchObject({ resourceId: '/users/u1/outings/abc' })
  })

  it('Warning and Error always emit even without DEBUG', () => {
    const out: unknown[] = []
    const spyLog = vi.spyOn(console, 'log').mockImplementation((s: string) => { out.push(JSON.parse(s)) })
    const spyErr = vi.spyOn(console, 'error').mockImplementation((s: string) => { out.push(JSON.parse(s)) })
    try {
      const log = createLogger({ env: {}, traceId: 't', spanId: 's' })
      log.warn('foo/bar/read', { category: 'Application' })
      log.error('foo/bar/read', { category: 'Application' })
      expect(out).toHaveLength(2)
      expect(out[0]).toMatchObject({ level: 'Warning' })
      expect(out[1]).toMatchObject({ level: 'Error' })
    } finally {
      spyLog.mockRestore()
      spyErr.mockRestore()
    }
  })
})
