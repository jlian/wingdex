#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const RUNTIME_BASE_URL = process.env.RUNTIME_BASE_URL?.replace(/\/$/, '')
const DEFAULT_BASE_URL_CANDIDATES = [
  'http://127.0.0.1:5000',
  'http://localhost:5000',
  'http://127.0.0.1:8788',
  'http://localhost:8788',
]
const MODEL_TIER = process.env.RUNTIME_MODEL_TIER === 'strong' ? 'strong' : 'fast'
const RESIZE_MAX_DIM = Number(process.env.FIXTURE_RESIZE_MAX_DIM || 640)
const JPEG_QUALITY = Number(process.env.FIXTURE_JPEG_QUALITY || 70)
const FIXTURE_DIR = join(process.cwd(), 'src', '__tests__', 'fixtures', 'llm-responses')
const IMAGE_DIR = join(process.cwd(), 'src', 'assets', 'images')
const OUT_DIR = join(process.cwd(), 'test-results')
const OUT_RESULTS = join(OUT_DIR, `runtime-latency-${MODEL_TIER}-results.json`)
const OUT_SUMMARY = join(OUT_DIR, `runtime-latency-${MODEL_TIER}-summary.json`)

function percentile(values, p) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

function extractCookies(setCookieHeaders) {
  return setCookieHeaders
    .map(entry => String(entry).split(';')[0])
    .filter(Boolean)
    .join('; ')
}

function safeParseJSON(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function isServerReachable(baseUrl) {
  const response = await fetch(`${baseUrl}/api/auth/get-session`, {
    method: 'GET',
  })

  return response.ok
}

async function resolveBaseUrl() {
  if (RUNTIME_BASE_URL) {
    const ok = await isServerReachable(RUNTIME_BASE_URL)
    if (!ok) {
      throw new Error(`Server check failed at ${RUNTIME_BASE_URL}`)
    }
    return RUNTIME_BASE_URL
  }

  for (const candidate of DEFAULT_BASE_URL_CANDIDATES) {
    try {
      const ok = await isServerReachable(candidate)
      if (ok) return candidate
    } catch {
      // Try next candidate
    }
  }

  throw new Error('No healthy runtime API found on default ports. Set RUNTIME_BASE_URL explicitly.')
}

async function createAnonymousSession(baseUrl) {
  const response = await fetch(`${baseUrl}/api/auth/sign-in/anonymous`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Anonymous sign-in failed: HTTP ${response.status} ${text.slice(0, 200)}`)
  }

  const setCookies = response.headers.getSetCookie?.() || []
  const cookieHeader = extractCookies(setCookies)
  if (!cookieHeader) {
    throw new Error('No auth cookies returned from anonymous sign-in')
  }

  return cookieHeader
}

async function main() {
  const baseUrl = await resolveBaseUrl()
  console.log(`Using runtime base URL: ${baseUrl}`)
  const cookieHeader = await createAnonymousSession(baseUrl)

  const fixtureFiles = readdirSync(FIXTURE_DIR).filter(name => name.endsWith('.json')).sort()
  const results = []

  for (const fixtureName of fixtureFiles) {
    const fixture = JSON.parse(readFileSync(join(FIXTURE_DIR, fixtureName), 'utf8'))
    const imageFile = fixture.imageFile
    const imagePath = join(IMAGE_DIR, imageFile)

    const preprocessStart = Date.now()
    const sourceBuffer = readFileSync(imagePath)
    const resizedBuffer = await sharp(sourceBuffer)
      .rotate()
      .resize({
        width: RESIZE_MAX_DIM,
        height: RESIZE_MAX_DIM,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer()
    const resizedMeta = await sharp(resizedBuffer).metadata()
    const preprocessMs = Date.now() - preprocessStart

    const payload = {
      imageDataUrl: `data:image/jpeg;base64,${resizedBuffer.toString('base64')}`,
      imageWidth: resizedMeta.width || null,
      imageHeight: resizedMeta.height || null,
      lat: fixture.context?.lat,
      lon: fixture.context?.lon,
      month: fixture.context?.month,
      locationName: fixture.context?.locationName,
      model: MODEL_TIER,
    }

    const requestStart = Date.now()
    const response = await fetch(`${baseUrl}/api/identify-bird`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
      },
      body: JSON.stringify(payload),
    })
    const requestMs = Date.now() - requestStart

    const bodyText = await response.text()
    const responseJson = safeParseJSON(bodyText)
    let candidateCount = 0
    if (response.ok) {
      candidateCount = Array.isArray(responseJson?.candidates) ? responseJson.candidates.length : 0
    }

    results.push({
      fixture: fixtureName,
      imageFile,
      inputContext: {
        lat: fixture.context?.lat,
        lon: fixture.context?.lon,
        month: fixture.context?.month,
        locationName: fixture.context?.locationName,
      },
      model: MODEL_TIER,
      preprocessMs,
      requestMs,
      totalMs: preprocessMs + requestMs,
      status: response.status,
      ok: response.ok,
      candidateCount,
      responseJson,
      responseText: bodyText,
      error: response.ok ? null : bodyText.slice(0, 200),
    })

    console.log(`${response.ok ? '✅' : '❌'} ${fixtureName} request=${requestMs}ms total=${preprocessMs + requestMs}ms status=${response.status}`)
  }

  const okResults = results.filter(item => item.ok)
  const requestTimes = okResults.map(item => item.requestMs)
  const totalTimes = okResults.map(item => item.totalMs)

  const summary = {
    capturedAt: new Date().toISOString(),
    baseUrl,
    model: MODEL_TIER,
    fixtureCount: results.length,
    successCount: okResults.length,
    failureCount: results.length - okResults.length,
    requestMs: {
      min: requestTimes.length ? Math.min(...requestTimes) : null,
      median: percentile(requestTimes, 50),
      p95: percentile(requestTimes, 95),
      max: requestTimes.length ? Math.max(...requestTimes) : null,
    },
    totalMs: {
      min: totalTimes.length ? Math.min(...totalTimes) : null,
      median: percentile(totalTimes, 50),
      p95: percentile(totalTimes, 95),
      max: totalTimes.length ? Math.max(...totalTimes) : null,
    },
  }

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(OUT_RESULTS, JSON.stringify(results, null, 2) + '\n')
  writeFileSync(OUT_SUMMARY, JSON.stringify(summary, null, 2) + '\n')

  console.log(`Saved: ${OUT_RESULTS}`)
  console.log(`Saved: ${OUT_SUMMARY}`)
  console.log(JSON.stringify(summary, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
