#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const fixtureDir = join(root, 'src', '__tests__', 'fixtures', 'llm-responses')
const outFile = join(root, 'test-results', 'fixture-capture-summary-fast.json')

const files = readdirSync(fixtureDir).filter(name => name.endsWith('.json')).sort()
const fixtures = files.map(name => JSON.parse(readFileSync(join(fixtureDir, name), 'utf8')))

const durations = fixtures.map(f => f.durationMs).filter(value => typeof value === 'number')
const candidateCounts = fixtures.map(f => Array.isArray(f?.parsed?.candidates) ? f.parsed.candidates.length : 0)
const confidences = fixtures
  .flatMap(f => Array.isArray(f?.parsed?.candidates) ? f.parsed.candidates : [])
  .map(c => Number(c?.confidence))
  .filter(Number.isFinite)

function percentile(values, p) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

const confidenceBands = {
  '0.30-0.49': 0,
  '0.50-0.74': 0,
  '0.75-0.89': 0,
  '0.90-1.00': 0,
}

for (const value of confidences) {
  if (value >= 0.30 && value < 0.50) confidenceBands['0.30-0.49'] += 1
  else if (value >= 0.50 && value < 0.75) confidenceBands['0.50-0.74'] += 1
  else if (value >= 0.75 && value < 0.90) confidenceBands['0.75-0.89'] += 1
  else if (value >= 0.90 && value <= 1.00) confidenceBands['0.90-1.00'] += 1
}

const summary = {
  capturedAt: new Date().toISOString(),
  fixtureCount: fixtures.length,
  model: fixtures[0]?.model || 'unknown',
  timingMs: {
    min: durations.length ? Math.min(...durations) : null,
    median: percentile(durations, 50),
    p95: percentile(durations, 95),
    max: durations.length ? Math.max(...durations) : null,
  },
  candidates: {
    minPerFixture: candidateCounts.length ? Math.min(...candidateCounts) : null,
    maxPerFixture: candidateCounts.length ? Math.max(...candidateCounts) : null,
    allAtLeastTwo: candidateCounts.length > 0 && candidateCounts.every(count => count >= 2),
    total: candidateCounts.reduce((sum, count) => sum + count, 0),
  },
  confidenceBands,
}

mkdirSync(join(root, 'test-results'), { recursive: true })
writeFileSync(outFile, JSON.stringify(summary, null, 2) + '\n')

console.log(`Saved: ${outFile}`)
console.log(JSON.stringify(summary, null, 2))
