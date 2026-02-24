#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const FIXTURE_DIR = join(ROOT, 'src', '__tests__', 'fixtures', 'llm-responses')
const TAXONOMY_PATH = join(ROOT, 'src', 'lib', 'taxonomy.json')

const taxonomy = JSON.parse(readFileSync(TAXONOMY_PATH, 'utf8'))
const scientificToCommon = new Map(
  taxonomy.map(entry => [String(entry[1]).toLowerCase(), String(entry[0])])
)

function canonicalizeSpeciesLabel(species) {
  const label = String(species || '').trim()
  if (!label) return label

  const match = label.match(/^(.+?)\s*\(([^()]+)\)$/)
  if (!match) return label

  const scientific = match[2].trim()
  const canonicalCommon = scientificToCommon.get(scientific.toLowerCase())
  if (!canonicalCommon) return label

  return `${canonicalCommon} (${scientific})`
}

function canonicalizeParsed(parsed) {
  if (!parsed || !Array.isArray(parsed.candidates)) return parsed

  return {
    ...parsed,
    candidates: parsed.candidates.map(candidate => ({
      ...candidate,
      species: canonicalizeSpeciesLabel(candidate?.species),
    })),
  }
}

let changedFiles = 0
const fixtureFiles = readdirSync(FIXTURE_DIR).filter(name => name.endsWith('.json')).sort()

for (const fixtureFile of fixtureFiles) {
  const fixturePath = join(FIXTURE_DIR, fixtureFile)
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))

  const canonicalParsed = canonicalizeParsed(fixture.parsed)
  const canonicalRawResponse = canonicalParsed
    ? JSON.stringify(canonicalParsed)
    : String(fixture.rawResponse || '')

  const nextFixture = {
    ...fixture,
    rawResponse: canonicalRawResponse,
    parsed: canonicalParsed,
  }

  const before = JSON.stringify(fixture)
  const after = JSON.stringify(nextFixture)
  if (before !== after) {
    writeFileSync(fixturePath, JSON.stringify(nextFixture, null, 2) + '\n')
    changedFiles += 1
    console.log(`✅ normalized ${fixtureFile}`)
  }
}

console.log(`Done. Updated ${changedFiles} fixture file(s).`)
