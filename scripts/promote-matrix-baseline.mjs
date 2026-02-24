#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const MATRIX_IMAGES_DIR = join(ROOT, 'test-results', 'fixture-matrix', 'images')
const MATRIX_REPORT_PATH = join(ROOT, 'test-results', 'fixture-matrix', 'report.json')
const FIXTURE_DIR = join(ROOT, 'src', '__tests__', 'fixtures', 'llm-responses')
const SOURCE = process.env.BASELINE_SOURCE === 'runtime' ? 'runtime' : 'llm'
const MODEL = process.env.BASELINE_MODEL === 'strong' ? 'strong' : 'fast'
const REQUIRED_RUNS = Number(process.env.BASELINE_REQUIRED_RUNS || 3)
const ALLOW_PARTIAL = process.env.BASELINE_ALLOW_PARTIAL === 'true'

function speciesTop1(response) {
  if (!response?.ok) return ''
  const top = response?.responseJson?.candidates?.[0]?.species
  return String(top || '').trim()
}

function medianByRequestMs(items) {
  if (items.length === 0) return null
  const sorted = [...items].sort((a, b) => a.requestMs - b.requestMs)
  return sorted[Math.floor(sorted.length / 2)]
}

function chooseResponse(runs) {
  const okRuns = runs.filter(run => run?.ok && run?.responseJson)
  if (okRuns.length === 0) return null

  const buckets = new Map()
  for (const run of okRuns) {
    const key = speciesTop1(run) || '__empty__'
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(run)
  }

  const ranked = [...buckets.entries()].sort((a, b) => {
    const countDelta = b[1].length - a[1].length
    if (countDelta !== 0) return countDelta
    return (a[0] || '').localeCompare(b[0] || '')
  })

  const winnerRuns = ranked[0][1]
  return medianByRequestMs(winnerRuns) || medianByRequestMs(okRuns)
}

function buildFixture(imageRecord, chosen) {
  const parsed = chosen.responseJson || null
  const rawResponse = parsed ? JSON.stringify(parsed) : String(chosen.responseText || '')

  return {
    imageFile: imageRecord.imageFile,
    context: {
      lat: imageRecord.context?.lat,
      lon: imageRecord.context?.lon,
      month: imageRecord.context?.month,
      locationName: imageRecord.context?.locationName,
    },
    rawResponse,
    parsed,
    model: chosen.modelName || `${SOURCE}:${MODEL}`,
    requestConfig: {
      promotedFromMatrix: true,
      source: SOURCE,
      modelTier: MODEL,
      ...(chosen.requestConfig || {}),
    },
    durationMs: chosen.requestMs,
    capturedAt: chosen.capturedAt,
    promotedAt: new Date().toISOString(),
  }
}

function main() {
  const report = JSON.parse(readFileSync(MATRIX_REPORT_PATH, 'utf8'))
  const fixtureFiles = readdirSync(FIXTURE_DIR).filter(name => name.endsWith('.json')).sort()
  const files = readdirSync(MATRIX_IMAGES_DIR).filter(name => name.endsWith('.json')).sort()

  if (!ALLOW_PARTIAL) {
    const expectedResponsesPerImage = REQUIRED_RUNS * 4
    const runs = Number(report?.config?.runs || 0)
    const reportFixtureCount = Number(report?.config?.fixtureCount || 0)
    const reportExpectedResponses = Number(report?.config?.expectedResponsesPerImage || 0)

    if (runs < REQUIRED_RUNS) {
      throw new Error(`Refusing promotion: matrix report runs=${runs}, required=${REQUIRED_RUNS}. Run full matrix first.`)
    }
    if (reportFixtureCount !== fixtureFiles.length) {
      throw new Error(`Refusing promotion: matrix fixtureCount=${reportFixtureCount}, expected=${fixtureFiles.length}. Run full matrix first.`)
    }
    if (reportExpectedResponses !== expectedResponsesPerImage) {
      throw new Error(`Refusing promotion: expectedResponsesPerImage=${reportExpectedResponses}, expected=${expectedResponsesPerImage}.`)
    }
    if (files.length !== fixtureFiles.length) {
      throw new Error(`Refusing promotion: matrix images=${files.length}, expected fixtures=${fixtureFiles.length}.`)
    }
  }

  let promoted = 0
  const skipped = []

  for (const file of files) {
    const matrixPath = join(MATRIX_IMAGES_DIR, file)
    const imageRecord = JSON.parse(readFileSync(matrixPath, 'utf8'))

    const runs = imageRecord?.responses?.[SOURCE]?.[MODEL]
    if (!Array.isArray(runs)) {
      skipped.push({ file, reason: 'missing runs array' })
      continue
    }

    const chosen = chooseResponse(runs)
    if (!chosen) {
      skipped.push({ file, reason: 'no successful runs' })
      continue
    }

    const fixture = buildFixture(imageRecord, chosen)
    writeFileSync(join(FIXTURE_DIR, file), JSON.stringify(fixture, null, 2) + '\n')
    promoted += 1
  }

  console.log(`Promoted ${promoted}/${files.length} fixtures from matrix (${SOURCE}:${MODEL}).`)
  if (skipped.length > 0) {
    console.log('Skipped:')
    for (const item of skipped) {
      console.log(`- ${item.file}: ${item.reason}`)
    }
  }
}

main()
