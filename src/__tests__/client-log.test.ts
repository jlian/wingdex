import { describe, expect, it, vi } from 'vitest'
import { clientLog, logClientFailure } from '../lib/client-log'

function captureLogs(fn: () => void): unknown[] {
  const out: unknown[] = []
  const spyLog = vi.spyOn(console, 'log').mockImplementation((s: string) => { out.push(JSON.parse(s)) })
  const spyErr = vi.spyOn(console, 'error').mockImplementation((s: string) => { out.push(JSON.parse(s)) })
  try {
    fn()
  } finally {
    spyLog.mockRestore()
    spyErr.mockRestore()
  }
  return out
}

describe('clientLog', () => {
  it('info emits Info level with tier: web', () => {
    const [entry] = captureLogs(() => clientLog.info('data/outings/write', { resultType: 'Succeeded' }))
    expect(entry).toMatchObject({
      level: 'Info',
      tier: 'web',
      operationName: 'data/outings/write',
      resultType: 'Succeeded',
    })
    expect(typeof (entry as { time: string }).time).toBe('string')
  })

  it('warn emits Warning level', () => {
    const [entry] = captureLogs(() => clientLog.warn('test/op', { resultDescription: 'something bad' }))
    expect(entry).toMatchObject({ level: 'Warning', resultDescription: 'something bad' })
  })

  it('error emits Error level', () => {
    const [entry] = captureLogs(() => clientLog.error('test/op', { resultType: 'Failed', resultSignature: 500 }))
    expect(entry).toMatchObject({ level: 'Error', resultType: 'Failed', resultSignature: 500 })
  })

  it('debug emits Debug level', () => {
    const [entry] = captureLogs(() => clientLog.debug('test/op'))
    expect(entry).toMatchObject({ level: 'Debug' })
  })

  it('warn and error route to console.error', () => {
    const spyErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    const spyLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      clientLog.warn('test/op')
      clientLog.error('test/op')
      expect(spyErr).toHaveBeenCalledTimes(2)
      expect(spyLog).not.toHaveBeenCalled()
    } finally {
      spyErr.mockRestore()
      spyLog.mockRestore()
    }
  })

  it('info and debug route to console.log', () => {
    const spyErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    const spyLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      clientLog.info('test/op')
      clientLog.debug('test/op')
      expect(spyLog).toHaveBeenCalledTimes(2)
      expect(spyErr).not.toHaveBeenCalled()
    } finally {
      spyErr.mockRestore()
      spyLog.mockRestore()
    }
  })

  it('omits empty properties', () => {
    const [entry] = captureLogs(() => clientLog.info('test/op'))
    expect(entry).not.toHaveProperty('properties')
    expect(entry).not.toHaveProperty('resultType')
  })
})

describe('logClientFailure', () => {
  it('extracts status code from error message prefix', () => {
    const [entry] = captureLogs(() => logClientFailure('data/outings/write', new Error('400 Invalid JSON body')))
    expect(entry).toMatchObject({
      level: 'Error',
      operationName: 'data/outings/write',
      resultType: 'Failed',
      resultSignature: 400,
      resultDescription: '400 Invalid JSON body',
    })
  })

  it('handles non-Error values', () => {
    const [entry] = captureLogs(() => logClientFailure('test/op', 'string error'))
    expect(entry).toMatchObject({
      resultType: 'Failed',
      resultDescription: 'string error',
    })
    expect((entry as { resultSignature?: number }).resultSignature).toBeUndefined()
  })

  it('handles error without status prefix', () => {
    const [entry] = captureLogs(() => logClientFailure('test/op', new Error('Network error')))
    expect(entry).toMatchObject({
      resultDescription: 'Network error',
    })
    expect((entry as { resultSignature?: number }).resultSignature).toBeUndefined()
  })

  it('includes properties when provided', () => {
    const [entry] = captureLogs(() => logClientFailure('test/op', new Error('fail'), { outingId: 'abc' }))
    expect(entry).toMatchObject({
      properties: { outingId: 'abc' },
    })
  })

  it('extracts 500 status', () => {
    const [entry] = captureLogs(() => logClientFailure('test/op', new Error('500 Internal Server Error')))
    expect((entry as { resultSignature: number }).resultSignature).toBe(500)
  })
})
