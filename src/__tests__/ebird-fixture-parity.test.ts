import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

function readNormalized(filePath: string): string {
  return readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n').trim()
}

describe('eBird fixture parity', () => {
  it('keeps demo CSV and e2e fixture CSV in sync', () => {
    const demoCsvPath = path.resolve(process.cwd(), 'src/assets/ebird-import.csv')
    const e2eCsvPath = path.resolve(process.cwd(), 'e2e/fixtures/ebird-import.csv')

    const demoCsv = readNormalized(demoCsvPath)
    const e2eCsv = readNormalized(e2eCsvPath)

    expect(demoCsv).toBe(e2eCsv)
  })
})
