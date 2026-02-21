#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { buildBirdIdPrompt } from '../functions/lib/bird-id-prompt.js'

const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions'
const DEFAULT_MODELS = ['gpt-5-mini', 'gpt-5-nano']
const DEFAULT_IMAGES = [
  {
    label: 'Canada Goose',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/79/Canada_Goose_%28Branta_canadensis%29.jpg/640px-Canada_Goose_%28Branta_canadensis%29.jpg',
  },
  {
    label: 'Mallard',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/Male_mallard_duck_2.jpg/640px-Male_mallard_duck_2.jpg',
  },
  {
    label: 'Blue Jay',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/Blue_Jay_in_PP_%2830980%29.jpg/640px-Blue_Jay_in_PP_%2830980%29.jpg',
  },
]

function parseArgs(argv) {
  const parsed = {
    models: DEFAULT_MODELS,
    images: DEFAULT_IMAGES,
    repeats: 1,
    maxCompletionTokens: 1400,
    reasoningEffort: 'low',
    endpoint: DEFAULT_ENDPOINT,
    timeoutMs: 120000,
  }

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    const next = argv[index + 1]

    if (arg === '--models' && next) {
      parsed.models = next.split(',').map(x => x.trim()).filter(Boolean)
      index++
      continue
    }

    if (arg === '--repeats' && next) {
      parsed.repeats = Math.max(1, Number.parseInt(next, 10) || 1)
      index++
      continue
    }

    if (arg === '--max-completion-tokens' && next) {
      parsed.maxCompletionTokens = Math.max(1, Number.parseInt(next, 10) || parsed.maxCompletionTokens)
      index++
      continue
    }

    if (arg === '--reasoning-effort' && next) {
      parsed.reasoningEffort = next
      index++
      continue
    }

    if (arg === '--endpoint' && next) {
      parsed.endpoint = next
      index++
      continue
    }

    if (arg === '--timeout-ms' && next) {
      parsed.timeoutMs = Math.max(1000, Number.parseInt(next, 10) || parsed.timeoutMs)
      index++
      continue
    }

    if (arg === '--images-file' && next) {
      parsed.images = next
      index++
      continue
    }

    if (arg === '--help' || arg === '-h') {
      parsed.help = true
      continue
    }
  }

  return parsed
}

function printHelp() {
  console.log(`Usage: node scripts/benchmark-vision-models.mjs [options]

Options:
  --models <m1,m2>                Comma-separated models (default: gpt-5-mini,gpt-5-nano)
  --repeats <n>                   Number of calls per image/model (default: 1)
  --max-completion-tokens <n>     Completion token budget (default: 1400)
  --reasoning-effort <level>      Reasoning effort (default: low)
  --images-file <path>            JSON file with [{"label":"...","url":"..."}] or [{"label":"...","file":"src/...jpg"}]
  --endpoint <url>                OpenAI-compatible chat/completions endpoint
  --timeout-ms <n>                HTTP timeout per call in ms (default: 120000)
  --help                          Show this help

Environment:
  Reads OPENAI_API_KEY from process env, then falls back to .dev.vars
`)
}

function parseDevVars(content) {
  const env = {}
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const [key, ...rest] = line.split('=')
    env[key.trim()] = rest.join('=').trim()
  }
  return env
}

async function resolveApiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
  if (!existsSync('.dev.vars')) return ''
  const content = await readFile('.dev.vars', 'utf8')
  const vars = parseDevVars(content)
  return vars.OPENAI_API_KEY || ''
}

async function resolveImages(imagesOrPath) {
  const normalizeArray = (array) => array
    .map((item, index) => ({
      label: String(item?.label || `image-${index + 1}`),
      url: typeof item?.url === 'string' ? item.url : '',
      file: typeof item?.file === 'string' ? item.file : '',
      lat: Number.isFinite(Number(item?.lat)) ? Number(item.lat) : undefined,
      lon: Number.isFinite(Number(item?.lon)) ? Number(item.lon) : undefined,
      month: Number.isFinite(Number(item?.month)) ? Number(item.month) : undefined,
      locationName: typeof item?.locationName === 'string' ? item.locationName : undefined,
    }))
    .filter(item => item.url || item.file)

  if (!Array.isArray(imagesOrPath)) {
    const content = await readFile(imagesOrPath, 'utf8')
    const parsed = JSON.parse(content)
    if (!Array.isArray(parsed)) {
      throw new Error('images-file must be a JSON array')
    }
    return normalizeArray(parsed)
  }

  return normalizeArray(imagesOrPath)
}

function inferMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'application/octet-stream'
}

async function resolveImageUrl(image) {
  if (image.url) {
    return image.url
  }

  if (!image.file) {
    throw new Error(`No url or file provided for image ${image.label}`)
  }

  const bytes = await readFile(image.file)
  const base64 = bytes.toString('base64')
  const mime = inferMimeType(image.file)
  return `data:${mime};base64,${base64}`
}

function extractContent(payload) {
  const message = payload?.choices?.[0]?.message
  const content = message?.content

  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    const joined = content
      .map((part) => {
        if (typeof part === 'string') return part
        if (typeof part?.text === 'string') return part.text
        if (typeof part?.content === 'string') return part.content
        return ''
      })
      .filter(Boolean)
      .join('\n')

    if (joined) return joined
  }

  return ''
}

function safeParseJSON(text) {
  try {
    return JSON.parse(text)
  } catch {}

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim())
    } catch {}
  }

  const objectLike = text.match(/\{[\s\S]*\}/)
  if (objectLike?.[0]) {
    try {
      return JSON.parse(objectLike[0])
    } catch {}
  }

  return null
}

function shouldUseMaxCompletionTokens(model) {
  const normalized = model.toLowerCase()
  return normalized.includes('gpt-5') || normalized.startsWith('o1') || normalized.startsWith('o3') || normalized.startsWith('o4')
}

function withTokenLimit(model, maxTokens) {
  if (shouldUseMaxCompletionTokens(model)) {
    return { max_completion_tokens: maxTokens }
  }

  return { max_tokens: maxTokens }
}

function withReasoningOptions(model, reasoningEffort) {
  if (model.toLowerCase().includes('gpt-5')) {
    return { reasoning_effort: reasoningEffort }
  }

  return {}
}

function buildRequestBody({ model, imageUrl, maxCompletionTokens, reasoningEffort }) {
  const location = Number.isFinite(imageUrl.lat) && Number.isFinite(imageUrl.lon)
    ? { lat: imageUrl.lat, lon: imageUrl.lon }
    : undefined
  const prompt = buildBirdIdPrompt(location, imageUrl.month, imageUrl.locationName)

  return {
    model,
    response_format: { type: 'json_object' },
    ...withTokenLimit(model, maxCompletionTokens),
    ...withReasoningOptions(model, reasoningEffort),
    messages: [
      {
        role: 'system',
        content: 'You are an expert ornithologist assistant. Return only what is asked.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: prompt,
          },
          { type: 'image_url', image_url: { url: imageUrl.url, detail: 'auto' } },
        ],
      },
    ],
  }
}

async function callModel({ endpoint, apiKey, timeoutMs, model, image, maxCompletionTokens, reasoningEffort }) {
  const startedAt = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const imageUrl = await resolveImageUrl(image)

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(buildRequestBody({
        model,
        imageUrl: {
          url: imageUrl,
          lat: image.lat,
          lon: image.lon,
          month: image.month,
          locationName: image.locationName,
        },
        maxCompletionTokens,
        reasoningEffort,
      })),
      signal: controller.signal,
    })

    const elapsedMs = Date.now() - startedAt
    const rawText = await response.text()

    if (!response.ok) {
      return {
        ok: false,
        model,
        label: image.label,
        latMs: elapsedMs,
        status: response.status,
        error: rawText.slice(0, 220),
      }
    }

    const payload = JSON.parse(rawText)
    const content = extractContent(payload)
    const parsed = safeParseJSON(content)
    const candidates = Array.isArray(parsed?.candidates) ? parsed.candidates : []
    const usage = payload?.usage || {}

    return {
      ok: true,
      model,
      label: image.label,
      latMs: elapsedMs,
      parsed: Boolean(parsed && typeof parsed === 'object'),
      candidateCount: candidates.length,
      topCandidate: candidates?.[0]?.species || '',
      finishReason: payload?.choices?.[0]?.finish_reason || '',
      completionTokens: usage.completion_tokens ?? null,
      reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? null,
    }
  } catch (error) {
    const elapsedMs = Date.now() - startedAt
    return {
      ok: false,
      model,
      label: image.label,
      latMs: elapsedMs,
      status: 'EXCEPTION',
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timeout)
  }
}

function summarizeByModel(results) {
  const models = [...new Set(results.map(x => x.model))]

  return models.map(model => {
    const rows = results.filter(x => x.model === model)
    const okRows = rows.filter(x => x.ok)
    const parsedRows = okRows.filter(x => x.parsed)
    const avgLatency = okRows.length
      ? Math.round(okRows.reduce((sum, row) => sum + row.latMs, 0) / okRows.length)
      : null

    return {
      model,
      calls: rows.length,
      okCalls: okRows.length,
      parsedCalls: parsedRows.length,
      parseRate: okRows.length ? `${Math.round((parsedRows.length / okRows.length) * 100)}%` : '0%',
      avgLatencyMs: avgLatency,
    }
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  const apiKey = await resolveApiKey()
  if (!apiKey) {
    console.error('OPENAI_API_KEY not found in env or .dev.vars')
    process.exitCode = 1
    return
  }

  const images = await resolveImages(args.images)
  if (!images.length) {
    console.error('No images configured for benchmark')
    process.exitCode = 1
    return
  }

  console.log(JSON.stringify({
    endpoint: args.endpoint,
    models: args.models,
    repeats: args.repeats,
    images: images.map(image => image.label),
    maxCompletionTokens: args.maxCompletionTokens,
    reasoningEffort: args.reasoningEffort,
    timeoutMs: args.timeoutMs,
  }, null, 2))

  const results = []
  for (const model of args.models) {
    for (const image of images) {
      for (let attempt = 1; attempt <= args.repeats; attempt++) {
        const row = await callModel({
          endpoint: args.endpoint,
          apiKey,
          timeoutMs: args.timeoutMs,
          model,
          image,
          maxCompletionTokens: args.maxCompletionTokens,
          reasoningEffort: args.reasoningEffort,
        })

        results.push(row)
        console.log(JSON.stringify({ ...row, attempt }))
      }
    }
  }

  console.log('\n=== Summary ===')
  for (const summary of summarizeByModel(results)) {
    console.log(JSON.stringify(summary))
  }
}

await main()
