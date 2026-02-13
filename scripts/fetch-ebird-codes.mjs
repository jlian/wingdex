#!/usr/bin/env node
/**
 * Fetch eBird species codes and update taxonomy.json.
 *
 * Downloads the public eBird taxonomy CSV (no API key needed),
 * matches species by scientific name, and writes updated taxonomy.json
 * with [commonName, scientificName, ebirdCode] tuples.
 *
 * Usage:
 *   node scripts/fetch-ebird-codes.mjs
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TAXONOMY_PATH = resolve(__dirname, '../src/lib/taxonomy.json')

// Public eBird taxonomy CSV (no API key required)
const EBIRD_CSV_URL = 'https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=csv&cat=species'

/**
 * Parse CSV text, handling quoted fields.
 * Returns array of row arrays.
 */
function parseCSV(text) {
  const rows = []
  const lines = text.split('\n')
  for (const line of lines) {
    if (!line.trim()) continue
    const row = []
    let i = 0
    while (i < line.length) {
      if (line[i] === '"') {
        // Quoted field
        let field = ''
        i++ // skip opening quote
        while (i < line.length) {
          if (line[i] === '"' && line[i + 1] === '"') {
            field += '"'
            i += 2
          } else if (line[i] === '"') {
            i++ // skip closing quote
            break
          } else {
            field += line[i]
            i++
          }
        }
        row.push(field)
        if (line[i] === ',') i++ // skip comma
      } else {
        const comma = line.indexOf(',', i)
        if (comma === -1) {
          row.push(line.substring(i).trim())
          break
        } else {
          row.push(line.substring(i, comma))
          i = comma + 1
        }
      }
    }
    rows.push(row)
  }
  return rows
}

async function main() {
  // 1. Load current taxonomy
  const currentTaxonomy = JSON.parse(readFileSync(TAXONOMY_PATH, 'utf-8'))
  console.log(`Loaded ${currentTaxonomy.length} species from taxonomy.json`)

  // 2. Fetch the eBird taxonomy CSV
  console.log('Fetching eBird taxonomy CSV (public, no API key)...')
  const res = await fetch(EBIRD_CSV_URL)
  if (!res.ok) {
    console.error(`Failed to fetch eBird taxonomy: ${res.status} ${res.statusText}`)
    const body = await res.text()
    console.error(body.substring(0, 500))
    process.exit(1)
  }

  const csvText = await res.text()
  const rows = parseCSV(csvText)
  const header = rows[0]
  const dataRows = rows.slice(1)
  console.log(`Fetched ${dataRows.length} species from eBird taxonomy CSV`)

  // Find column indices
  const sciIdx = header.findIndex(h => h.toLowerCase().includes('sci'))
  const codeIdx = header.findIndex(h => h.toLowerCase().includes('species_code') || h.toLowerCase() === 'speciescode')

  // If column headers don't match exactly, try positional (SPECIES_CODE is column 2, SCI_NAME is column 4)
  const codeFinal = codeIdx >= 0 ? codeIdx : 1
  const sciFinal = sciIdx >= 0 ? sciIdx : 4

  console.log(`Using columns: code=${codeFinal} (${header[codeFinal]}), sci=${sciFinal} (${header[sciFinal]})`)

  // 3. Build a lookup by scientific name → species code
  const sciToCode = new Map()
  for (const row of dataRows) {
    if (row.length > Math.max(codeFinal, sciFinal)) {
      sciToCode.set(row[sciFinal].toLowerCase().trim(), row[codeFinal].trim())
    }
  }

  // 4. Match and build updated taxonomy
  let matched = 0
  let unmatched = 0
  const unmatchedSpecies = []
  const updated = currentTaxonomy.map((entry) => {
    const common = entry[0]
    const scientific = entry[1]
    const code = sciToCode.get(scientific.toLowerCase())
    if (code) {
      matched++
      return [common, scientific, code]
    } else {
      unmatched++
      unmatchedSpecies.push(scientific)
      return [common, scientific, '']
    }
  })

  console.log(`\nMatched: ${matched}, Unmatched: ${unmatched}`)
  if (unmatchedSpecies.length > 0 && unmatchedSpecies.length <= 20) {
    console.log('Unmatched species:', unmatchedSpecies.join(', '))
  }

  // 5. Write updated taxonomy
  writeFileSync(TAXONOMY_PATH, JSON.stringify(updated))
  console.log(`\nUpdated taxonomy.json with species codes`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
