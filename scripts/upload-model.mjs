#!/usr/bin/env node
/**
 * Upload on-device model assets to the `wingdex-models` R2 bucket.
 *
 * These files exceed Cloudflare's 25 MiB static-asset limit, so they live in R2
 * and are served via functions/models/[[path]].ts.
 *
 * Prereqs:
 *   - Create the bucket once: `npx wrangler r2 bucket create wingdex-models`
 *   - R2 API creds in env or .dev.vars: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *     CF_ACCOUNT_ID
 *   - Build the assets on a GPU box:
 *       spike/bioclip/scripts/export-onnx.py      -> bioclip2_visual_int8.onnx
 *       spike/bioclip/scripts/gen-demo-assets.py  -> text_embeds_int8.bin,
 *                                                    text_embeds_scale.bin,
 *                                                    species.json
 *     and place all four in a local dir (default ./model-assets/).
 *
 * Usage:
 *   node scripts/upload-model.mjs [assetsDir]
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const assetsDir = resolve(process.cwd(), process.argv[2] || 'model-assets')
const BUCKET = 'wingdex-models'

const FILES = [
  { name: 'bioclip2_visual_int8.onnx', type: 'application/octet-stream' },
  { name: 'text_embeds_int8.bin', type: 'application/octet-stream' },
  { name: 'text_embeds_scale.bin', type: 'application/octet-stream' },
  { name: 'species.json', type: 'application/json' },
]

function readDevVars() {
  const p = resolve(ROOT, '.dev.vars')
  if (!existsSync(p)) return {}
  const v = {}
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq > 0) v[t.slice(0, eq)] = t.slice(eq + 1)
  }
  return v
}

const dv = readDevVars()
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || dv.CF_ACCOUNT_ID
const accessKeyId = process.env.R2_ACCESS_KEY_ID || dv.R2_ACCESS_KEY_ID
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || dv.R2_SECRET_ACCESS_KEY

if (!CF_ACCOUNT_ID || !accessKeyId || !secretAccessKey) {
  console.error('Missing CF_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY (env or .dev.vars)')
  process.exit(1)
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
})

let failed = 0
for (const f of FILES) {
  const path = resolve(assetsDir, f.name)
  if (!existsSync(path)) {
    console.error(`  MISSING: ${path}`)
    failed++
    continue
  }
  const body = readFileSync(path)
  process.stdout.write(`Uploading ${f.name} (${(body.length / 1e6).toFixed(1)} MB)… `)
  try {
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: f.name, Body: body, ContentType: f.type }))
    console.log('ok')
  } catch (e) {
    console.log(`FAILED: ${e.name || e.message}`)
    failed++
  }
}
if (failed) {
  console.error(`\n${failed} file(s) failed. Ensure the bucket exists: npx wrangler r2 bucket create ${BUCKET}`)
  process.exit(1)
}
console.log('\nAll model assets uploaded to R2. They are served at /models/<name>.')
