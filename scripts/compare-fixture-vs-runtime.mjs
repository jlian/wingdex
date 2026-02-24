#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const MODEL_TIER = process.env.RUNTIME_MODEL_TIER === 'strong' ? 'strong' : 'fast'
const ROOT = process.cwd()
const FIXTURE_DIR = join(ROOT, 'src', '__tests__', 'fixtures', 'llm-responses')
const RUNTIME_RESULTS_PATH = join(ROOT, 'test-results', `runtime-latency-${MODEL_TIER}-results.json`)
const RUNTIME_SUMMARY_PATH = join(ROOT, 'test-results', `runtime-latency-${MODEL_TIER}-summary.json`)
const LLM_SUMMARY_PATH = MODEL_TIER === 'strong'
  ? join(ROOT, 'test-results', 'fixture-capture-summary-strong-timing.json')
  : join(ROOT, 'test-results', 'fixture-capture-summary-fast.json')
const OUT_DIR = join(ROOT, 'test-results')
const OUT_PATH = join(OUT_DIR, `runtime-vs-llm-${MODEL_TIER}-comparison.json`)
const SUPPORTS_PER_FIXTURE_LATENCY_DELTA = MODEL_TIER === 'fast'

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function speciesNameList(candidates) {
  if (!Array.isArray(candidates)) return []
  return candidates
    .map(candidate => String(candidate?.species || '').trim())
    .filter(Boolean)
}

function intersectionCount(a, b) {
  const left = new Set(a)
  let matches = 0
  for (const value of b) {
    if (left.has(value)) matches += 1
  }
  return matches
}

function percentile(values, p) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function loadJsonIfExists(path) {
  try {
    return loadJson(path)
  } catch {
    return null
  }
}

function compareOne(fixture, runtimeEntry) {
  const fixtureCandidates = speciesNameList(fixture?.parsed?.candidates)
  const runtimeCandidates = speciesNameList(runtimeEntry?.responseJson?.candidates)

  const fixtureTop1 = fixtureCandidates[0] || null
  const runtimeTop1 = runtimeCandidates[0] || null

  const fixtureTop2 = fixtureCandidates.slice(0, 2)
  const runtimeTop2 = runtimeCandidates.slice(0, 2)

  const fixtureMultipleBirds = fixture?.parsed?.multipleBirds === true
  const runtimeMultipleBirds = runtimeEntry?.responseJson?.multipleBirds === true

  const llmFixtureDurationMs = SUPPORTS_PER_FIXTURE_LATENCY_DELTA && isFiniteNumber(fixture?.durationMs)
    ? fixture.durationMs
    : null

  return {
    fixture: runtimeEntry.fixture,
    imageFile: runtimeEntry.imageFile,
    status: runtimeEntry.status,
    ok: runtimeEntry.ok,
    fixtureTop1,
    runtimeTop1,
    top1Match: fixtureTop1 !== null && runtimeTop1 !== null && fixtureTop1 === runtimeTop1,
    fixtureTop2,
    runtimeTop2,
    top2OverlapCount: intersectionCount(fixtureTop2, runtimeTop2),
    fixtureCandidateCount: fixtureCandidates.length,
    runtimeCandidateCount: runtimeCandidates.length,
    fixtureMultipleBirds,
    runtimeMultipleBirds,
    multipleBirdsMatch: fixtureMultipleBirds === runtimeMultipleBirds,
    llmFixtureDurationMs,
    runtimeRequestMs: runtimeEntry.requestMs,
    runtimeTotalMs: runtimeEntry.totalMs,
    runtimeMinusLlmRequestMs: isFiniteNumber(llmFixtureDurationMs)
      ? runtimeEntry.requestMs - llmFixtureDurationMs
      : null,
  }
}

function main() {
  const runtimeResults = loadJson(RUNTIME_RESULTS_PATH)
  const runtimeSummary = loadJsonIfExists(RUNTIME_SUMMARY_PATH)
  const llmSummary = loadJsonIfExists(LLM_SUMMARY_PATH)
  const fixtureFiles = readdirSync(FIXTURE_DIR).filter(name => name.endsWith('.json'))
  const fixturesByName = new Map(
    fixtureFiles.map(name => [name, loadJson(join(FIXTURE_DIR, name))])
  )

  const details = runtimeResults.map(entry => {
    const fixture = fixturesByName.get(entry.fixture)
    if (!fixture) {
      return {
        fixture: entry.fixture,
        imageFile: entry.imageFile,
        status: entry.status,
        ok: false,
        missingFixture: true,
      }
    }

    return compareOne(fixture, entry)
  })

  const comparable = details.filter(item => !item.missingFixture && item.ok)
  const latencyComparable = comparable
    .map(item => item.runtimeMinusLlmRequestMs)
    .filter(isFiniteNumber)

  const runtimeMedian = runtimeSummary?.requestMs?.median
  const runtimeP95 = runtimeSummary?.requestMs?.p95
  const llmMedian = llmSummary?.timingMs?.median
  const llmP95 = llmSummary?.timingMs?.p95

  const summary = {
    capturedAt: new Date().toISOString(),
    model: MODEL_TIER,
    runtimeResultPath: RUNTIME_RESULTS_PATH,
    fixtureDir: FIXTURE_DIR,
    totalEntries: details.length,
    comparableEntries: comparable.length,
    top1MatchCount: comparable.filter(item => item.top1Match).length,
    top1MatchRate: comparable.length > 0
      ? Number((comparable.filter(item => item.top1Match).length / comparable.length).toFixed(4))
      : null,
    top2AnyOverlapCount: comparable.filter(item => item.top2OverlapCount > 0).length,
    top2AnyOverlapRate: comparable.length > 0
      ? Number((comparable.filter(item => item.top2OverlapCount > 0).length / comparable.length).toFixed(4))
      : null,
    multipleBirdsMatchCount: comparable.filter(item => item.multipleBirdsMatch).length,
    multipleBirdsMatchRate: comparable.length > 0
      ? Number((comparable.filter(item => item.multipleBirdsMatch).length / comparable.length).toFixed(4))
      : null,
    latency: {
      runtimeSummaryPath: RUNTIME_SUMMARY_PATH,
      llmSummaryPath: LLM_SUMMARY_PATH,
      runtimeRequestMs: {
        median: isFiniteNumber(runtimeMedian) ? runtimeMedian : null,
        p95: isFiniteNumber(runtimeP95) ? runtimeP95 : null,
      },
      llmCaptureMs: {
        median: isFiniteNumber(llmMedian) ? llmMedian : null,
        p95: isFiniteNumber(llmP95) ? llmP95 : null,
      },
      aggregateRuntimeMinusLlmMs: {
        median: isFiniteNumber(runtimeMedian) && isFiniteNumber(llmMedian)
          ? runtimeMedian - llmMedian
          : null,
        p95: isFiniteNumber(runtimeP95) && isFiniteNumber(llmP95)
          ? runtimeP95 - llmP95
          : null,
      },
      perFixtureRuntimeMinusLlmRequestMs: {
        supported: SUPPORTS_PER_FIXTURE_LATENCY_DELTA,
        comparableEntries: latencyComparable.length,
        min: latencyComparable.length > 0 ? Math.min(...latencyComparable) : null,
        median: percentile(latencyComparable, 50),
        p95: percentile(latencyComparable, 95),
        max: latencyComparable.length > 0 ? Math.max(...latencyComparable) : null,
      },
    },
  }

  const report = {
    summary,
    details,
  }

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(OUT_PATH, JSON.stringify(report, null, 2) + '\n')

  console.log(`Saved: ${OUT_PATH}`)
  console.log(JSON.stringify(summary, null, 2))
}

main()
