#!/usr/bin/env node
/**
 * Upload range-prior cell blobs to local R2 by writing directly to
 * Miniflare's persistence directory (SQLite + blob files).
 *
 * This bypasses the Miniflare HTTP proxy entirely, avoiding macOS
 * ephemeral port exhaustion. Handles 680K+ files efficiently.
 *
 * Usage:
 *   node scripts/upload-range-priors-local.mjs
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'
import Database from 'better-sqlite3'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cellsDir = resolve(__dirname, '../.tmp/range-priors/cells')
const r2Dir = resolve(__dirname, '../.wrangler/state/v3/r2')

const metaDir = resolve(r2Dir, 'miniflare-R2BucketObject')
const blobDir = resolve(r2Dir, 'wingdex-range-priors/blobs')

mkdirSync(metaDir, { recursive: true })
mkdirSync(blobDir, { recursive: true })

// Find SQLite file or use the standard hash name
const sqliteFiles = readdirSync(metaDir).filter(f => f.endsWith('.sqlite') && !f.includes('-shm') && !f.includes('-wal'))
const dbPath = sqliteFiles.length > 0
  ? resolve(metaDir, sqliteFiles[0])
  : resolve(metaDir, '17241f888bb37ab4875603bd9160075fb1cab8df35f907cd83ba114f0fd7d208.sqlite')

const files = readdirSync(cellsDir).filter(f => f.endsWith('.bin.gz'))
if (files.length === 0) {
  console.error('No cell blobs found. Run build-range-priors.py first.')
  process.exit(1)
}

console.log(`Uploading ${files.length} blobs to local R2 (direct SQLite)...`)

const db = Database(dbPath)

db.exec(`
  CREATE TABLE IF NOT EXISTS _mf_objects (
    key TEXT PRIMARY KEY,
    blob_id TEXT,
    version TEXT NOT NULL,
    size INTEGER NOT NULL,
    etag TEXT NOT NULL,
    uploaded INTEGER NOT NULL,
    checksums TEXT NOT NULL,
    http_metadata TEXT NOT NULL,
    custom_metadata TEXT NOT NULL
  )
`)

// Clear old data and stale blob files
const oldCount = db.prepare('SELECT count(*) as c FROM _mf_objects').get().c
if (oldCount > 0) {
  console.log(`  Clearing ${oldCount} old entries and stale blob files...`)
  db.exec('DELETE FROM _mf_objects')
  rmSync(blobDir, { recursive: true, force: true })
  mkdirSync(blobDir, { recursive: true })
}

const insert = db.prepare(`
  INSERT OR REPLACE INTO _mf_objects (key, blob_id, version, size, etag, uploaded, checksums, http_metadata, custom_metadata)
  VALUES (?, ?, ?, ?, ?, ?, '{}', '{}', '{}')
`)

const t0 = Date.now()
let uploaded = 0

const batchInsert = db.transaction((batch) => {
  for (const { key, blobId, data, etag } of batch) {
    writeFileSync(resolve(blobDir, blobId), data)
    insert.run(key, blobId, etag, data.length, etag, Date.now())
  }
})

const BATCH_SIZE = 5000
let batch = []

for (const file of files) {
  const filePath = resolve(cellsDir, file)
  const data = readFileSync(filePath)
  const etag = createHash('md5').update(data).digest('hex')
  const blobId = createHash('sha256').update(data).digest('hex') + Date.now().toString(16).padStart(16, '0')
  const key = `range-priors/${file}`

  batch.push({ key, blobId, data, etag })

  if (batch.length >= BATCH_SIZE) {
    batchInsert(batch)
    uploaded += batch.length
    batch = []
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
    const rate = (uploaded / (Date.now() - t0) * 1000).toFixed(0)
    console.log(`  ${uploaded}/${files.length} (${rate}/sec, ${elapsed}s)`)
  }
}

if (batch.length > 0) {
  batchInsert(batch)
  uploaded += batch.length
}

db.close()

const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
console.log(`\nDone: ${uploaded} blobs uploaded in ${elapsed}s`)
