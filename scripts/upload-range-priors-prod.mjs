#!/usr/bin/env node
/**
 * Upload range-prior cell blobs to production R2 via the S3-compatible API.
 *
 * Uses parallel uploads for speed (~100x faster than wrangler CLI).
 * Requires R2 API credentials set as environment variables:
 *   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 *
 * Create these at: Cloudflare Dashboard > R2 > Manage R2 API Tokens
 *
 * Usage:
 *   R2_ACCESS_KEY_ID=xxx R2_SECRET_ACCESS_KEY=yyy node scripts/upload-range-priors-prod.mjs
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { readdirSync, readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cellsDir = resolve(__dirname, '../.tmp/range-priors/cells')
const devVarsPath = resolve(__dirname, '../.dev.vars')

const BUCKET = 'wingdex-range-priors'
const CONCURRENCY = 50

// Read credentials from env or .dev.vars
function readDevVars() {
  if (!existsSync(devVarsPath)) return {}
  const vars = {}
  for (const line of readFileSync(devVarsPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq > 0) vars[trimmed.slice(0, eq)] = trimmed.slice(eq + 1)
  }
  return vars
}

const devVars = readDevVars()
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || devVars.CF_ACCOUNT_ID
const accessKeyId = process.env.R2_ACCESS_KEY_ID || devVars.R2_ACCESS_KEY_ID
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || devVars.R2_SECRET_ACCESS_KEY

if (!CF_ACCOUNT_ID) {
  console.error('Set CF_ACCOUNT_ID in .dev.vars or as an environment variable.')
  process.exit(1)
}

if (!accessKeyId || !secretAccessKey) {
  console.error('Set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY environment variables.')
  console.error('Create at: Cloudflare Dashboard > R2 > Manage R2 API Tokens')
  process.exit(1)
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
})

const files = readdirSync(cellsDir).filter(f => f.endsWith('.bin.gz'))
if (files.length === 0) {
  console.error('No cell blobs found. Run build-range-priors.py first.')
  process.exit(1)
}

console.log(`Uploading ${files.length} blobs to R2 (${CONCURRENCY} concurrent)...`)

const t0 = Date.now()
let uploaded = 0
let errors = 0

async function uploadOne(file) {
  const key = `range-priors/${file}`
  const data = readFileSync(resolve(cellsDir, file))
  try {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: data,
      ContentType: 'application/gzip',
    }))
    uploaded++
  } catch (e) {
    errors++
    if (errors <= 5) console.error(`  Error: ${file}: ${e.message?.substring(0, 80)}`)
  }
}

// Process in batches with concurrency limit
for (let i = 0; i < files.length; i += CONCURRENCY) {
  const batch = files.slice(i, i + CONCURRENCY)
  await Promise.all(batch.map(uploadOne))

  if ((uploaded + errors) % 5000 < CONCURRENCY) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
    const rate = (uploaded / (Date.now() - t0) * 1000).toFixed(0)
    console.log(`  ${uploaded}/${files.length} (${rate}/sec, ${elapsed}s, ${errors} errors)`)
  }
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
console.log(`\nDone: ${uploaded} uploaded, ${errors} errors in ${elapsed}s`)
