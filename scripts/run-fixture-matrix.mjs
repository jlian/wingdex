#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { buildBirdIdPrompt } from '../functions/lib/bird-id-prompt.js'

const ROOT = process.cwd()
const FIXTURE_DIR = join(ROOT, 'src', '__tests__', 'fixtures', 'llm-responses')
const IMAGE_DIR = join(ROOT, 'src', 'assets', 'images')
const TAXONOMY_PATH = join(ROOT, 'src', 'lib', 'taxonomy.json')

const OUT_DIR = join(ROOT, 'test-results', 'fixture-matrix')
const OUT_IMAGES_DIR = join(OUT_DIR, 'images')
const OUT_REPORT_PATH = join(OUT_DIR, 'report.json')

const MATRIX_RUNS = Math.max(1, Number(process.env.MATRIX_RUNS || 3))
const MATRIX_FIXTURE_LIMIT = Math.max(0, Number(process.env.MATRIX_FIXTURE_LIMIT || 0))
const MATRIX_DELAY_MS = Math.max(0, Number(process.env.MATRIX_DELAY_MS || 300))

const RESIZE_MAX_DIM = Number(process.env.FIXTURE_RESIZE_MAX_DIM || 640)
const JPEG_QUALITY = Number(process.env.FIXTURE_JPEG_QUALITY || 70)
const MAX_COMPLETION_TOKENS = Number(process.env.FIXTURE_MAX_COMPLETION_TOKENS || 1400)

const RUNTIME_BASE_URL_OVERRIDE = process.env.RUNTIME_BASE_URL?.replace(/\/$/, '')
const DEFAULT_RUNTIME_BASE_URLS = [
  'http://127.0.0.1:5000',
  'http://localhost:5000',
  'http://127.0.0.1:8788',
  'http://localhost:8788',
]

const MODELS = ['fast', 'strong']

function parseDevVars() {
  if (!existsSync('.dev.vars')) return {}

  const vars = {}
  const content = readFileSync('.dev.vars', 'utf8')
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const [key, ...rest] = line.split('=')
    vars[key.trim()] = rest.join('=').trim()
  }

  return vars
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function safeParseJSON(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function percentile(values, p) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

function summarizeNumbers(values) {
  if (values.length === 0) {
    return { min: null, median: null, p95: null, max: null }
  }

  return {
    min: Math.min(...values),
    median: percentile(values, 50),
    p95: percentile(values, 95),
    max: Math.max(...values),
  }
}

function shouldUseMaxCompletionTokens(modelName) {
  const normalized = modelName.toLowerCase()
  return normalized.includes('gpt-5') || normalized.startsWith('o1') || normalized.startsWith('o3') || normalized.startsWith('o4')
}

function withTokenLimit(modelName, maxTokens) {
  if (shouldUseMaxCompletionTokens(modelName)) {
    return { max_completion_tokens: maxTokens }
  }

  return { max_tokens: maxTokens }
}

function withSamplingOptions(modelName) {
  if (shouldUseMaxCompletionTokens(modelName)) return {}

  return {
    temperature: 0.2,
    top_p: 1.0,
  }
}

function withReasoningOptions(modelName) {
  if (modelName.toLowerCase().includes('gpt-5')) {
    return { reasoning_effort: 'low' }
  }

  return {}
}

function extractCookies(setCookieHeaders) {
  return setCookieHeaders
    .map(entry => String(entry).split(';')[0])
    .filter(Boolean)
    .join('; ')
}

async function isRuntimeReachable(baseUrl) {
  const response = await fetch(`${baseUrl}/api/auth/get-session`, { method: 'GET' })
  return response.ok
}

async function resolveRuntimeBaseUrl() {
  if (RUNTIME_BASE_URL_OVERRIDE) {
    const ok = await isRuntimeReachable(RUNTIME_BASE_URL_OVERRIDE)
    if (!ok) {
      throw new Error(`Runtime health check failed at ${RUNTIME_BASE_URL_OVERRIDE}`)
    }
    return RUNTIME_BASE_URL_OVERRIDE
  }

  for (const baseUrl of DEFAULT_RUNTIME_BASE_URLS) {
    try {
      const ok = await isRuntimeReachable(baseUrl)
      if (ok) return baseUrl
    } catch {
      // try next
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

async function preprocessImage(imagePath) {
  const preprocessStart = Date.now()
  const sourceBuffer = readFileSync(imagePath)
  const sourceMeta = await sharp(sourceBuffer).metadata()
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

  return {
    preprocessMs: Date.now() - preprocessStart,
    sourceDimensions: {
      width: sourceMeta.width || null,
      height: sourceMeta.height || null,
    },
    uploadedDimensions: {
      width: resizedMeta.width || null,
      height: resizedMeta.height || null,
    },
    imageDataUrl: `data:image/jpeg;base64,${resizedBuffer.toString('base64')}`,
  }
}

function canonicalizeSpeciesLabel(species, scientificToCommon) {
  const label = String(species || '').trim()
  if (!label) return label

  const match = label.match(/^(.+?)\s*\(([^()]+)\)$/)
  if (!match) return label

  const scientific = match[2].trim()
  const canonicalCommon = scientificToCommon.get(scientific.toLowerCase())
  if (!canonicalCommon) return label

  return `${canonicalCommon} (${scientific})`
}

function canonicalizeParsed(parsed, scientificToCommon) {
  if (!parsed || !Array.isArray(parsed.candidates)) return parsed

  return {
    ...parsed,
    candidates: parsed.candidates.map(candidate => ({
      ...candidate,
      species: canonicalizeSpeciesLabel(candidate?.species, scientificToCommon),
    })),
  }
}

function getTop1Species(responseEntry) {
  if (!responseEntry?.ok) return null
  const candidates = responseEntry?.responseJson?.candidates
  if (!Array.isArray(candidates) || candidates.length === 0) return null
  const species = String(candidates[0]?.species || '').trim()
  return species || null
}

function getMultipleBirdsValue(responseEntry) {
  if (!responseEntry?.ok) return null
  return responseEntry?.responseJson?.multipleBirds === true
}

function buildImageSummary(imageRecord) {
  const summary = {
    responsesPresent: 0,
    llmVsRuntimeTop1MatchRateByModel: {},
    llmVsRuntimeMultipleBirdsMatchRateByModel: {},
  }

  for (const source of ['llm', 'runtime']) {
    for (const modelTier of MODELS) {
      summary.responsesPresent += imageRecord.responses[source][modelTier].length
    }
  }

  for (const modelTier of MODELS) {
    const llmRuns = imageRecord.responses.llm[modelTier]
    const runtimeRuns = imageRecord.responses.runtime[modelTier]
    const runCount = Math.min(llmRuns.length, runtimeRuns.length)

    const top1Matches = []
    const multipleBirdsMatches = []

    for (let index = 0; index < runCount; index++) {
      const left = llmRuns[index]
      const right = runtimeRuns[index]

      const leftTop1 = getTop1Species(left)
      const rightTop1 = getTop1Species(right)
      if (leftTop1 && rightTop1) {
        top1Matches.push(leftTop1 === rightTop1)
      }

      const leftMulti = getMultipleBirdsValue(left)
      const rightMulti = getMultipleBirdsValue(right)
      if (leftMulti !== null && rightMulti !== null) {
        multipleBirdsMatches.push(leftMulti === rightMulti)
      }
    }

    summary.llmVsRuntimeTop1MatchRateByModel[modelTier] = top1Matches.length > 0
      ? Number((top1Matches.filter(Boolean).length / top1Matches.length).toFixed(4))
      : null

    summary.llmVsRuntimeMultipleBirdsMatchRateByModel[modelTier] = multipleBirdsMatches.length > 0
      ? Number((multipleBirdsMatches.filter(Boolean).length / multipleBirdsMatches.length).toFixed(4))
      : null
  }

  return summary
}

function pushFailure(failures, item) {
  failures.push(item)
}

async function captureLlmResponse({
  entry,
  modelTier,
  llmConfig,
  scientificToCommon,
}) {
  const imagePath = join(IMAGE_DIR, entry.imageFile)
  const preprocessed = await preprocessImage(imagePath)

  const prompt = buildBirdIdPrompt(
    entry.context.lat != null && entry.context.lon != null
      ? { lat: entry.context.lat, lon: entry.context.lon }
      : undefined,
    entry.context.month,
    entry.context.locationName,
  )

  const modelName = modelTier === 'strong' ? llmConfig.strongModel : llmConfig.fastModel

  const body = {
    model: modelName,
    ...withReasoningOptions(modelName),
    ...withSamplingOptions(modelName),
    ...withTokenLimit(modelName, MAX_COMPLETION_TOKENS),
    messages: [
      { role: 'system', content: 'You are an expert ornithologist assistant. Return only what is asked.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: preprocessed.imageDataUrl, detail: 'auto' } },
        ],
      },
    ],
    response_format: { type: 'json_object' },
  }

  const requestStart = Date.now()
  const response = await fetch(llmConfig.apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${llmConfig.token}`,
      'Content-Type': 'application/json',
      ...(llmConfig.cfAigToken ? { 'cf-aig-authorization': `Bearer ${llmConfig.cfAigToken}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const requestMs = Date.now() - requestStart

  const responseBodyText = await response.text()
  const responseBodyJson = safeParseJSON(responseBodyText)
  const assistantText = responseBodyJson?.choices?.[0]?.message?.content
    ? String(responseBodyJson.choices[0].message.content)
    : ''
  const parsedRaw = safeParseJSON(assistantText)
  const parsedCanonical = canonicalizeParsed(parsedRaw, scientificToCommon)

  return {
    ok: response.ok,
    status: response.status,
    source: 'llm',
    modelTier,
    modelName,
    preprocessMs: preprocessed.preprocessMs,
    requestMs,
    totalMs: preprocessed.preprocessMs + requestMs,
    sourceDimensions: preprocessed.sourceDimensions,
    uploadedDimensions: preprocessed.uploadedDimensions,
    requestConfig: {
      tokenParam: shouldUseMaxCompletionTokens(modelName) ? 'max_completion_tokens' : 'max_tokens',
      maxCompletionTokens: MAX_COMPLETION_TOKENS,
      reasoningEffort: withReasoningOptions(modelName).reasoning_effort || null,
      resizeMaxDim: RESIZE_MAX_DIM,
      jpegQuality: JPEG_QUALITY,
    },
    responseText: assistantText,
    responseJson: parsedCanonical,
    responseJsonRaw: parsedRaw,
    providerResponse: responseBodyJson,
    providerResponseText: responseBodyText,
    error: response.ok ? null : responseBodyText.slice(0, 300),
    capturedAt: new Date().toISOString(),
  }
}

async function captureRuntimeResponse({
  entry,
  modelTier,
  runtimeConfig,
  cookieHeader,
}) {
  const imagePath = join(IMAGE_DIR, entry.imageFile)
  const preprocessed = await preprocessImage(imagePath)

  const payload = {
    imageDataUrl: preprocessed.imageDataUrl,
    imageWidth: preprocessed.uploadedDimensions.width,
    imageHeight: preprocessed.uploadedDimensions.height,
    lat: entry.context.lat,
    lon: entry.context.lon,
    month: entry.context.month,
    locationName: entry.context.locationName,
    model: modelTier,
  }

  const requestStart = Date.now()
  const response = await fetch(`${runtimeConfig.baseUrl}/api/identify-bird`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader,
    },
    body: JSON.stringify(payload),
  })
  const requestMs = Date.now() - requestStart

  const responseBodyText = await response.text()
  const responseBodyJson = safeParseJSON(responseBodyText)

  return {
    ok: response.ok,
    status: response.status,
    source: 'runtime',
    modelTier,
    modelName: modelTier,
    preprocessMs: preprocessed.preprocessMs,
    requestMs,
    totalMs: preprocessed.preprocessMs + requestMs,
    sourceDimensions: preprocessed.sourceDimensions,
    uploadedDimensions: preprocessed.uploadedDimensions,
    requestConfig: {
      resizeMaxDim: RESIZE_MAX_DIM,
      jpegQuality: JPEG_QUALITY,
      baseUrl: runtimeConfig.baseUrl,
    },
    responseText: responseBodyText,
    responseJson: responseBodyJson,
    error: response.ok ? null : responseBodyText.slice(0, 300),
    capturedAt: new Date().toISOString(),
  }
}

async function sleep(ms) {
  if (ms <= 0) return
  await new Promise(resolve => setTimeout(resolve, ms))
}

function loadFixtureEntries() {
  const files = readdirSync(FIXTURE_DIR)
    .filter(name => name.endsWith('.json'))
    .sort()

  const entries = files.map(file => {
    const fixture = loadJson(join(FIXTURE_DIR, file))
    return {
      fixtureFile: file,
      imageFile: fixture.imageFile,
      context: {
        lat: fixture.context?.lat,
        lon: fixture.context?.lon,
        month: fixture.context?.month,
        locationName: fixture.context?.locationName,
      },
    }
  })

  return MATRIX_FIXTURE_LIMIT > 0 ? entries.slice(0, MATRIX_FIXTURE_LIMIT) : entries
}

function buildInitialImageRecord(entry) {
  return {
    fixture: entry.fixtureFile,
    imageFile: entry.imageFile,
    context: entry.context,
    responses: {
      llm: {
        fast: [],
        strong: [],
      },
      runtime: {
        fast: [],
        strong: [],
      },
    },
    summary: null,
  }
}

function buildReport({ imageRecords, failures, runtimeBaseUrl, llmConfig }) {
  const allResponses = []

  for (const imageRecord of imageRecords) {
    for (const source of ['llm', 'runtime']) {
      for (const modelTier of MODELS) {
        for (const response of imageRecord.responses[source][modelTier]) {
          allResponses.push({
            fixture: imageRecord.fixture,
            source,
            modelTier,
            ...response,
          })
        }
      }
    }
  }

  const counts = {}
  const latencyBySourceModel = {}
  const top1MatchByModel = {}
  const multipleBirdsMatchByModel = {}
  const runtimeMinusLlmDeltaByModel = {}

  for (const source of ['llm', 'runtime']) {
    for (const modelTier of MODELS) {
      const key = `${source}:${modelTier}`
      const subset = allResponses.filter(item => item.source === source && item.modelTier === modelTier)
      const successSubset = subset.filter(item => item.ok)

      counts[key] = {
        total: subset.length,
        success: successSubset.length,
        failure: subset.length - successSubset.length,
      }

      latencyBySourceModel[key] = {
        requestMs: summarizeNumbers(successSubset.map(item => item.requestMs).filter(value => typeof value === 'number')),
        totalMs: summarizeNumbers(successSubset.map(item => item.totalMs).filter(value => typeof value === 'number')),
      }
    }
  }

  for (const modelTier of MODELS) {
    const top1Matches = []
    const multiMatches = []
    const latencyDeltas = []

    for (const imageRecord of imageRecords) {
      const llmRuns = imageRecord.responses.llm[modelTier]
      const runtimeRuns = imageRecord.responses.runtime[modelTier]
      const runCount = Math.min(llmRuns.length, runtimeRuns.length)

      for (let index = 0; index < runCount; index++) {
        const llmResponse = llmRuns[index]
        const runtimeResponse = runtimeRuns[index]

        const llmTop1 = getTop1Species(llmResponse)
        const runtimeTop1 = getTop1Species(runtimeResponse)
        if (llmTop1 && runtimeTop1) {
          top1Matches.push(llmTop1 === runtimeTop1)
        }

        const llmMulti = getMultipleBirdsValue(llmResponse)
        const runtimeMulti = getMultipleBirdsValue(runtimeResponse)
        if (llmMulti !== null && runtimeMulti !== null) {
          multiMatches.push(llmMulti === runtimeMulti)
        }

        if (llmResponse.ok && runtimeResponse.ok) {
          latencyDeltas.push(runtimeResponse.requestMs - llmResponse.requestMs)
        }
      }
    }

    top1MatchByModel[modelTier] = {
      comparable: top1Matches.length,
      matchCount: top1Matches.filter(Boolean).length,
      matchRate: top1Matches.length > 0
        ? Number((top1Matches.filter(Boolean).length / top1Matches.length).toFixed(4))
        : null,
    }

    multipleBirdsMatchByModel[modelTier] = {
      comparable: multiMatches.length,
      matchCount: multiMatches.filter(Boolean).length,
      matchRate: multiMatches.length > 0
        ? Number((multiMatches.filter(Boolean).length / multiMatches.length).toFixed(4))
        : null,
    }

    runtimeMinusLlmDeltaByModel[modelTier] = {
      comparable: latencyDeltas.length,
      requestMs: summarizeNumbers(latencyDeltas),
    }
  }

  return {
    capturedAt: new Date().toISOString(),
    config: {
      runs: MATRIX_RUNS,
      fixtureCount: imageRecords.length,
      expectedResponsesPerImage: 2 * 2 * MATRIX_RUNS,
      matrixDelayMs: MATRIX_DELAY_MS,
      resizeMaxDim: RESIZE_MAX_DIM,
      jpegQuality: JPEG_QUALITY,
      maxCompletionTokens: MAX_COMPLETION_TOKENS,
      runtimeBaseUrl,
      llmApiUrl: llmConfig.apiUrl,
      llmModels: {
        fast: llmConfig.fastModel,
        strong: llmConfig.strongModel,
      },
    },
    counts,
    latencyBySourceModel,
    comparison: {
      top1MatchByModel,
      multipleBirdsMatchByModel,
      runtimeMinusLlmDeltaByModel,
    },
    failures,
    outputs: {
      perImageDir: OUT_IMAGES_DIR,
      report: OUT_REPORT_PATH,
    },
  }
}

async function main() {
  mkdirSync(OUT_IMAGES_DIR, { recursive: true })

  const devVars = parseDevVars()
  const cfAccountId = process.env.CF_ACCOUNT_ID || devVars.CF_ACCOUNT_ID
  const aiGatewayId = process.env.AI_GATEWAY_ID || devVars.AI_GATEWAY_ID
  const llmApiUrl = process.env.FIXTURE_API_URL || (
    cfAccountId && aiGatewayId
      ? `https://gateway.ai.cloudflare.com/v1/${cfAccountId}/${aiGatewayId}/openai/chat/completions`
      : ''
  )
  const llmConfig = {
    apiUrl: llmApiUrl,
    token: process.env.OPENAI_API_KEY || devVars.OPENAI_API_KEY,
    cfAigToken: process.env.CF_AIG_TOKEN || devVars.CF_AIG_TOKEN,
    fastModel: process.env.FIXTURE_MODEL_FAST || process.env.FIXTURE_MODEL || 'gpt-4.1-mini',
    strongModel: process.env.FIXTURE_MODEL_STRONG || 'gpt-5-mini',
  }

  if (!llmConfig.token) {
    throw new Error('OPENAI_API_KEY is required (env or .dev.vars)')
  }
  if (!llmConfig.apiUrl) {
    throw new Error('CF_ACCOUNT_ID and AI_GATEWAY_ID are required unless FIXTURE_API_URL is set')
  }

  const runtimeBaseUrl = await resolveRuntimeBaseUrl()
  const runtimeConfig = { baseUrl: runtimeBaseUrl }

  const taxonomy = loadJson(TAXONOMY_PATH)
  const scientificToCommon = new Map(
    taxonomy.map(entry => [String(entry[1]).toLowerCase(), String(entry[0])])
  )

  const fixtureEntries = loadFixtureEntries()
  const imageRecords = fixtureEntries.map(buildInitialImageRecord)
  const imageRecordByFixture = new Map(imageRecords.map(record => [record.fixture, record]))
  const failures = []

  console.log(`Running matrix: fixtures=${fixtureEntries.length}, runs=${MATRIX_RUNS}, responses/image=${2 * 2 * MATRIX_RUNS}`)
  console.log(`Runtime base URL: ${runtimeBaseUrl}`)

  for (let run = 1; run <= MATRIX_RUNS; run++) {
    for (const modelTier of MODELS) {
      console.log(`\nRun ${run}/${MATRIX_RUNS} - model=${modelTier}`)
      const cookieHeader = await createAnonymousSession(runtimeBaseUrl)

      for (let index = 0; index < fixtureEntries.length; index++) {
        const entry = fixtureEntries[index]
        const imageRecord = imageRecordByFixture.get(entry.fixtureFile)
        if (!imageRecord) continue

        const progress = `${index + 1}/${fixtureEntries.length}`
        console.log(`  [${progress}] ${entry.fixtureFile}`)

        try {
          const llmResponse = await captureLlmResponse({
            entry,
            modelTier,
            llmConfig,
            scientificToCommon,
          })
          imageRecord.responses.llm[modelTier].push({ run, ...llmResponse })
          if (!llmResponse.ok) {
            pushFailure(failures, {
              fixture: entry.fixtureFile,
              imageFile: entry.imageFile,
              run,
              source: 'llm',
              modelTier,
              status: llmResponse.status,
              error: llmResponse.error,
            })
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          imageRecord.responses.llm[modelTier].push({
            run,
            ok: false,
            status: 0,
            source: 'llm',
            modelTier,
            modelName: modelTier,
            preprocessMs: 0,
            requestMs: 0,
            totalMs: 0,
            sourceDimensions: { width: null, height: null },
            uploadedDimensions: { width: null, height: null },
            requestConfig: null,
            responseText: '',
            responseJson: null,
            responseJsonRaw: null,
            providerResponse: null,
            providerResponseText: '',
            error: message,
            capturedAt: new Date().toISOString(),
          })
          pushFailure(failures, {
            fixture: entry.fixtureFile,
            imageFile: entry.imageFile,
            run,
            source: 'llm',
            modelTier,
            status: 0,
            error: message,
          })
        }

        try {
          const runtimeResponse = await captureRuntimeResponse({
            entry,
            modelTier,
            runtimeConfig,
            cookieHeader,
          })
          imageRecord.responses.runtime[modelTier].push({ run, ...runtimeResponse })
          if (!runtimeResponse.ok) {
            pushFailure(failures, {
              fixture: entry.fixtureFile,
              imageFile: entry.imageFile,
              run,
              source: 'runtime',
              modelTier,
              status: runtimeResponse.status,
              error: runtimeResponse.error,
            })
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          imageRecord.responses.runtime[modelTier].push({
            run,
            ok: false,
            status: 0,
            source: 'runtime',
            modelTier,
            modelName: modelTier,
            preprocessMs: 0,
            requestMs: 0,
            totalMs: 0,
            sourceDimensions: { width: null, height: null },
            uploadedDimensions: { width: null, height: null },
            requestConfig: null,
            responseText: '',
            responseJson: null,
            error: message,
            capturedAt: new Date().toISOString(),
          })
          pushFailure(failures, {
            fixture: entry.fixtureFile,
            imageFile: entry.imageFile,
            run,
            source: 'runtime',
            modelTier,
            status: 0,
            error: message,
          })
        }

        await sleep(MATRIX_DELAY_MS)
      }
    }
  }

  for (const imageRecord of imageRecords) {
    imageRecord.summary = buildImageSummary(imageRecord)
    writeFileSync(
      join(OUT_IMAGES_DIR, imageRecord.fixture),
      JSON.stringify(imageRecord, null, 2) + '\n'
    )
  }

  const report = buildReport({
    imageRecords,
    failures,
    runtimeBaseUrl,
    llmConfig,
  })

  writeFileSync(OUT_REPORT_PATH, JSON.stringify(report, null, 2) + '\n')

  console.log(`\nSaved per-image matrix files to: ${OUT_IMAGES_DIR}`)
  console.log(`Saved report: ${OUT_REPORT_PATH}`)
  console.log(JSON.stringify(report.counts, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
