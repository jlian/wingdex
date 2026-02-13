import { describe, it, expect, beforeAll } from 'vitest'
import { computeFileHash } from '@/lib/photo-utils'

// jsdom's File doesn't implement arrayBuffer() — polyfill it
beforeAll(() => {
  if (!File.prototype.arrayBuffer) {
    File.prototype.arrayBuffer = function () {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.onerror = () => reject(reader.error)
        reader.readAsArrayBuffer(this)
      })
    }
  }
})

describe('computeFileHash', () => {
  it('returns a 64-character hex string (SHA-256)', async () => {
    const file = new File(['hello world'], 'test.txt', { type: 'text/plain' })
    const hash = await computeFileHash(file)

    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces the same hash for identical content', async () => {
    const content = 'same content here'
    const file1 = new File([content], 'a.txt')
    const file2 = new File([content], 'b.txt')

    const hash1 = await computeFileHash(file1)
    const hash2 = await computeFileHash(file2)

    expect(hash1).toBe(hash2)
  })

  it('produces different hashes for different content', async () => {
    const file1 = new File(['content A'], 'a.txt')
    const file2 = new File(['content B'], 'b.txt')

    const hash1 = await computeFileHash(file1)
    const hash2 = await computeFileHash(file2)

    expect(hash1).not.toBe(hash2)
  })

  it('handles empty file', async () => {
    const file = new File([], 'empty.txt')
    const hash = await computeFileHash(file)

    // SHA-256 of empty input is a known value
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('handles binary content', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]) // PNG header bytes
    const file = new File([bytes], 'test.png', { type: 'image/png' })
    const hash = await computeFileHash(file)

    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})
