/**
 * On-device bird identification with BioCLIP-2 (ViT-L int8) via onnxruntime-web.
 *
 * This is the on-device half of the adaptive router (see model-router.ts). It:
 *   - lazily loads onnxruntime-web + the model (from R2 via /models/*) with
 *     progress + download-speed measurement,
 *   - caches the model + text-embedding matrix in the Cache API (instant on
 *     later visits),
 *   - runs the image encoder on WebGPU (WASM fallback),
 *   - scores the image embedding against the shipped 11k int8 text-embedding
 *     matrix (one matmul) to produce candidates + a softmax confidence,
 *   - hands candidates to the shared server-side /api/range-adjust endpoint so
 *     the taxonomy + range + gate pipeline is identical to the GPT path.
 *
 * Everything here is dynamically imported so the main bundle is unaffected when
 * the feature is off.
 */

import type { BirdIdResult } from './ai-inference'
import { fetchWithLocalAuthRetry } from './local-auth-fetch'

// Asset URLs (served from R2 via the Worker; see functions/models/[[path]].ts).
const MODEL_URL = '/models/bioclip2_visual_int8.onnx'
const TEXT_EMBEDS_URL = '/models/text_embeds_int8.bin'
const TEXT_SCALE_URL = '/models/text_embeds_scale.bin'
const SPECIES_URL = '/models/species.json'

const CACHE_NAME = 'wingdex-bioclip-v1'
const EMBED_DIM = 768
const SOFTMAX_TEMP = 0.01
const CROP_GATE = 0.6 // softmax_top1 below this => ambiguous, suggest manual crop

// CLIP image normalization constants.
const MEAN = [0.48145466, 0.4578275, 0.40821073]
const STD = [0.26862954, 0.26130258, 0.27577711]

export interface ModelLoadProgress {
  phase: 'idle' | 'assets' | 'model-download' | 'model-init' | 'ready' | 'error'
  receivedBytes?: number
  totalBytes?: number
  kbps?: number
  etaSeconds?: number
  error?: string
}

type SpeciesEntry = { c: string; e: string } // common name, ebird code

// Module-level singletons (survive for the tab session).
let ortModule: typeof import('onnxruntime-web') | null = null
let session: unknown = null
let textInt8: Int8Array | null = null
let textScale: Float32Array | null = null
let species: SpeciesEntry[] | null = null
let loadPromise: Promise<void> | null = null

export function isModelReady(): boolean {
  return session !== null && textInt8 !== null && textScale !== null && species !== null
}

/** Whether the model is already cached (=> load will be fast, no big download). */
export async function isModelCached(): Promise<boolean> {
  if (typeof caches === 'undefined') return false
  try {
    const cache = await caches.open(CACHE_NAME)
    const hit = await cache.match(MODEL_URL)
    return !!hit
  } catch {
    return false
  }
}

async function fetchCached(cache: Cache, url: string): Promise<ArrayBuffer> {
  const hit = await cache.match(url)
  if (hit) return hit.arrayBuffer()
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`fetch ${url} failed: ${resp.status}`)
  const buf = await resp.arrayBuffer()
  await cache.put(url, new Response(buf))
  return buf
}

/**
 * Load the model + assets. Idempotent: concurrent/repeat calls share one load.
 * `onProgress` reports download speed so callers can decide to keep waiting or
 * fall back to the server.
 */
export function loadModel(onProgress?: (p: ModelLoadProgress) => void): Promise<void> {
  if (isModelReady()) return Promise.resolve()
  if (loadPromise) return loadPromise
  loadPromise = doLoad(onProgress).catch(err => {
    loadPromise = null // allow retry
    throw err
  })
  return loadPromise
}

async function doLoad(onProgress?: (p: ModelLoadProgress) => void): Promise<void> {
  const report = (p: ModelLoadProgress) => onProgress?.(p)
  const cache = typeof caches !== 'undefined' ? await caches.open(CACHE_NAME) : null

  report({ phase: 'assets' })
  const [tBuf, sBuf, spBuf] = await Promise.all([
    cache ? fetchCached(cache, TEXT_EMBEDS_URL) : fetch(TEXT_EMBEDS_URL).then(r => r.arrayBuffer()),
    cache ? fetchCached(cache, TEXT_SCALE_URL) : fetch(TEXT_SCALE_URL).then(r => r.arrayBuffer()),
    cache ? fetchCached(cache, SPECIES_URL) : fetch(SPECIES_URL).then(r => r.arrayBuffer()),
  ])
  textInt8 = new Int8Array(tBuf)
  textScale = new Float32Array(sBuf)
  species = JSON.parse(new TextDecoder().decode(spBuf)) as SpeciesEntry[]

  // Model: stream with progress unless already cached.
  let modelBuf: ArrayBuffer
  const cachedModel = cache ? await cache.match(MODEL_URL) : null
  if (cachedModel) {
    modelBuf = await cachedModel.arrayBuffer()
  } else {
    report({ phase: 'model-download', receivedBytes: 0 })
    modelBuf = await streamModel(cache, report)
  }

  report({ phase: 'model-init' })
  ortModule = await import('onnxruntime-web/webgpu')
  try {
    session = await ortModule.InferenceSession.create(modelBuf, { executionProviders: ['webgpu'] })
  } catch {
    session = await ortModule.InferenceSession.create(modelBuf, { executionProviders: ['wasm'] })
  }
  report({ phase: 'ready' })
}

async function streamModel(cache: Cache | null, report: (p: ModelLoadProgress) => void): Promise<ArrayBuffer> {
  const t0 = performance.now()
  const resp = await fetch(MODEL_URL)
  if (!resp.ok || !resp.body) throw new Error(`model fetch failed: ${resp.status}`)
  const total = Number(resp.headers.get('content-length')) || 0
  const reader = resp.body.getReader()

  // When the size is known, write directly into one preallocated buffer to
  // avoid holding chunks + a Blob + a final ArrayBuffer all at once (a ~3x
  // transient memory spike that risks OOM on mobile). Fall back to chunk
  // collection only when content-length is missing.
  const preallocated = total > 0 ? new Uint8Array(total) : null
  const chunks: Uint8Array[] = []
  let received = 0
  let lastReport = t0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (preallocated && received + value.length <= preallocated.length) {
      preallocated.set(value, received)
    } else if (preallocated) {
      // Server sent more than content-length claimed; spill the remainder.
      chunks.push(value)
    } else {
      chunks.push(value)
    }
    received += value.length
    const now = performance.now()
    if (now - lastReport > 300) {
      const kbps = (received / 1024) / ((now - t0) / 1000)
      const etaSeconds = total > 0 ? ((total - received) / 1024) / kbps : undefined
      report({ phase: 'model-download', receivedBytes: received, totalBytes: total || undefined, kbps, etaSeconds })
      lastReport = now
    }
  }

  let buf: ArrayBuffer
  if (preallocated && chunks.length === 0 && received === preallocated.length) {
    buf = preallocated.buffer
  } else {
    // Content-length was absent or inaccurate: assemble from whatever we have.
    const head = preallocated ? preallocated.subarray(0, Math.min(received, preallocated.length)) : null
    const parts = head ? [head, ...chunks] : chunks
    const size = parts.reduce((n, p) => n + p.length, 0)
    const out = new Uint8Array(size)
    let offset = 0
    for (const p of parts) { out.set(p, offset); offset += p.length }
    buf = out.buffer
  }
  if (cache) await cache.put(MODEL_URL, new Response(buf))
  return buf
}

/** Preprocess an image element to a 224x224 CLIP-normalized CHW tensor. */
function preprocess(ort: typeof import('onnxruntime-web'), img: HTMLImageElement) {
  const s = 224
  const canvas = document.createElement('canvas')
  canvas.width = s
  canvas.height = s
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D unavailable')
  // cover-fit center crop
  const scale = Math.max(s / img.width, s / img.height)
  const w = img.width * scale
  const h = img.height * scale
  ctx.drawImage(img, (s - w) / 2, (s - h) / 2, w, h)
  const data = ctx.getImageData(0, 0, s, s).data
  const out = new Float32Array(3 * s * s)
  for (let i = 0; i < s * s; i++) {
    out[i] = (data[i * 4] / 255 - MEAN[0]) / STD[0]
    out[i + s * s] = (data[i * 4 + 1] / 255 - MEAN[1]) / STD[1]
    out[i + 2 * s * s] = (data[i * 4 + 2] / 255 - MEAN[2]) / STD[2]
  }
  return new ort.Tensor('float32', out, [1, 3, s, s])
}

export interface OnDeviceCandidate {
  commonName: string
  scientificName?: string
  confidence: number
}

export interface OnDeviceRawResult {
  candidates: OnDeviceCandidate[]
  softmaxTop1: number
  suggestCrop: boolean
  inferenceMs: number
}

/**
 * Run BioCLIP on-device and return raw candidates (pre range-adjust).
 * Callers pass these to /api/range-adjust for the shared pipeline.
 */
export async function runOnDeviceInference(img: HTMLImageElement): Promise<OnDeviceRawResult> {
  if (!isModelReady() || !ortModule || !textInt8 || !textScale || !species) {
    throw new Error('Model not loaded')
  }
  const ort = ortModule
  const sess = session as import('onnxruntime-web').InferenceSession
  const t0 = performance.now()
  const input = preprocess(ort, img)
  const outputs = await sess.run({ [sess.inputNames[0]]: input })
  const emb = outputs[sess.outputNames[0]].data as Float32Array // normalized (768)

  const n = species.length
  const sims = new Float32Array(n)
  for (let r = 0; r < n; r++) {
    let dot = 0
    const base = r * EMBED_DIM
    const sc = textScale[r]
    for (let k = 0; k < EMBED_DIM; k++) dot += emb[k] * (textInt8[base + k] * sc)
    sims[r] = dot
  }
  // softmax for confidence
  let mx = -Infinity
  for (let i = 0; i < n; i++) if (sims[i] > mx) mx = sims[i]
  let sum = 0
  const exp = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const e = Math.exp((sims[i] - mx) / SOFTMAX_TEMP)
    exp[i] = e
    sum += e
  }
  // top-8 candidates
  const idx = Array.from(sims.keys()).sort((a, b) => sims[b] - sims[a]).slice(0, 8)
  const candidates: OnDeviceCandidate[] = idx.map(i => ({
    commonName: species![i].c,
    confidence: exp[i] / sum,
  }))
  const softmaxTop1 = candidates[0]?.confidence ?? 0
  return {
    candidates,
    softmaxTop1,
    suggestCrop: softmaxTop1 < CROP_GATE,
    inferenceMs: performance.now() - t0,
  }
}

/**
 * Full on-device identify: run inference, then apply the shared server pipeline
 * (taxonomy + range + gate) via /api/range-adjust. Returns the same BirdIdResult
 * shape as the GPT path so callers are agnostic.
 */
export async function identifyOnDevice(
  img: HTMLImageElement,
  location?: { lat: number; lon: number },
  month?: number,
): Promise<BirdIdResult> {
  const raw = await runOnDeviceInference(img)

  const resp = await fetchWithLocalAuthRetry('/api/range-adjust', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      candidates: raw.candidates,
      lat: location?.lat,
      lon: location?.lon,
      month,
    }),
  })

  if (!resp.ok) {
    // Range service failed; degrade gracefully to raw on-device candidates.
    return {
      candidates: raw.candidates.slice(0, 5).map(c => ({ species: c.commonName, confidence: c.confidence })),
      multipleBirds: raw.suggestCrop,
    }
  }

  const payload = await resp.json() as BirdIdResult
  return {
    candidates: Array.isArray(payload?.candidates) ? payload.candidates : [],
    rangeAdjusted: payload?.rangeAdjusted === true,
    // On-device has no bird detector; use the confidence gate as the crop signal.
    multipleBirds: raw.suggestCrop,
  }
}
