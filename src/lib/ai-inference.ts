import { findBestMatch } from './taxonomy'

// GitHub Models via Spark proxy — use full owner/model format
const VISION_MODEL = 'openai/gpt-4.1-mini'
const TEXT_MODEL = 'openai/gpt-4.1-mini'

interface VisionResult {
  species: string
  confidence: number
}

export interface BirdIdResult {
  candidates: VisionResult[]
  cropBox?: { x: number; y: number; width: number; height: number }
  multipleBirds?: boolean
}

/* ------------------------------------------------------------------ */
/*  Image helpers                                                      */
/* ------------------------------------------------------------------ */

function compressImage(img: HTMLImageElement, maxDim: number, quality: number): string {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported')

  const scale = Math.min(maxDim / Math.max(img.width, img.height), 1)
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', quality)
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

export function safeParseJSON(text: string): any {
  try { return JSON.parse(text) } catch {}
  const m1 = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (m1) { try { return JSON.parse(m1[1].trim()) } catch {} }
  const m2 = text.match(/\{[\s\S]*\}/)
  if (m2) { try { return JSON.parse(m2[0]) } catch {} }
  return null
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/* ------------------------------------------------------------------ */
/*  Direct /_spark/llm  — bypasses SDK max_tokens=1000 & temp=1.0     */
/* ------------------------------------------------------------------ */

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }

interface LLMOpts {
  jsonMode?: boolean
  maxTokens?: number
  temperature?: number
}

/** Text-only call */
async function sparkTextLLM(prompt: string, model: string, opts: LLMOpts = {}): Promise<string> {
  const { jsonMode = false, maxTokens = 2000, temperature = 0.2 } = opts
  const body = {
    messages: [
      { role: 'system', content: 'You are a helpful assistant. Return only what is asked.' },
      { role: 'user', content: prompt },
    ],
    temperature, top_p: 1.0, max_tokens: maxTokens, model,
    response_format: { type: jsonMode ? 'json_object' : 'text' },
  }
  const res = await fetch('/_spark/llm', {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) { const t = await res.text(); throw new Error(`LLM ${res.status}: ${t.substring(0, 300)}`) }
  return ((await res.json()) as any).choices[0].message.content
}

/**
 * Vision call using proper OpenAI multimodal message format.
 * Image is sent as an image_url content part, NOT embedded as raw text.
 */
async function sparkVisionLLM(
  textPrompt: string,
  imageDataUrl: string,
  model: string,
  opts: LLMOpts & { detail?: 'low' | 'high' | 'auto' } = {}
): Promise<string> {
  const { jsonMode = false, maxTokens = 2000, temperature = 0.2, detail = 'auto' } = opts
  const userContent: ContentPart[] = [
    { type: 'text', text: textPrompt },
    { type: 'image_url', image_url: { url: imageDataUrl, detail } },
  ]
  const body = {
    messages: [
      { role: 'system', content: 'You are an expert ornithologist assistant. Return only what is asked.' },
      { role: 'user', content: userContent },
    ],
    temperature, top_p: 1.0, max_tokens: maxTokens, model,
    response_format: { type: jsonMode ? 'json_object' : 'text' },
  }
  console.log(`📤 Vision request: ~${Math.round(JSON.stringify(body).length / 1024)}KB, detail=${detail}`)
  const res = await fetch('/_spark/llm', {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) { const t = await res.text(); throw new Error(`LLM ${res.status}: ${t.substring(0, 300)}`) }
  return ((await res.json()) as any).choices[0].message.content
}

/* ------------------------------------------------------------------ */
/*  Retry wrapper                                                      */
/* ------------------------------------------------------------------ */

async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let lastError: Error | null = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        const ms = 2000 * attempt
        console.log(`🔄 Retry ${attempt}/${retries} after ${ms}ms...`)
        await delay(ms)
      }
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      console.warn(`⚠️ Attempt ${attempt + 1} failed:`, lastError.message)
      if (/\b(400|413|422)\b/.test(lastError.message)) break
    }
  }
  throw lastError!
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export async function identifyBirdInPhoto(
  imageDataUrl: string,
  location?: { lat: number; lon: number },
  month?: number,
  locationName?: string
): Promise<BirdIdResult> {
  try {
    console.log('🐦 Starting bird ID...')
    const img = await loadImage(imageDataUrl)
    const compressed = compressImage(img, 512, 0.5)
    console.log(`📐 ID: ${Math.round(imageDataUrl.length / 1024)}KB → ${Math.round(compressed.length / 1024)}KB`)

    const ctxParts: string[] = []
    if (location) ctxParts.push(`Primary geolocation (authoritative): GPS ${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}.`)
    if (locationName) ctxParts.push(`Place label (secondary, may be noisy): ${locationName}.`)
    if (month !== undefined) {
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      ctxParts.push(`Month: ${months[month]}.`)
    }
    const ctx = ctxParts.length ? `\nContext:\n- ${ctxParts.join('\n- ')}` : ''

    const text = `Identify birds in this image and return ONE JSON object only.${ctx}

  Process (in order):
  1) Detect all birds.
  2) Select ONE focal bird: prefer the most notable/uncommon species; if all are common (gulls, pigeons, crows, sparrows), pick the largest clear one; if tied, nearest image center.
  3) Note the focal bird's center position in the image as a percentage.
  4) Identify only that focal bird.

  Rules:
  - Never mix traits across birds.
  - GPS and month are authoritative range constraints.
  - Location name is secondary habitat context only. If it conflicts with GPS/month, trust GPS/month.
  - Only suggest species expected at that location/time; account for regional splits and seasonal plumage.
  - Lower confidence for small/blurry/occluded/backlit birds.

  Candidates:
  - Return 1-3 candidates total (1 primary + up to 2 alternatives), sorted by confidence descending.
  - species format: "Common Name (Scientific name)".

  Confidence:
  - 0.90-1.00 diagnostic field marks clearly visible
  - 0.75-0.89 strong match
  - 0.50-0.74 likely
  - 0.30-0.49 possible

  Output JSON only:
  - Bird present: {"candidates":[{"species":"Common Name (Scientific name)","confidence":0.87}],"birdCenter":[35,60],"birdSize":"medium","multipleBirds":false}
  - No bird: {"candidates":[],"birdCenter":null,"birdSize":null,"multipleBirds":false}

  multipleBirds: true if more than one bird species is visible in the image.

  birdCenter: [x, y] percentage position of the focal bird's center.
  - Values 0-100 (percentage of image width and height)
  - integers only

  birdSize: how much of the image the bird fills.
  - "small" = bird is <20% of image area
  - "medium" = bird is 20-50%
  - "large" = bird is >50%`

    const response = await withRetry(() =>
      sparkVisionLLM(text, compressed, VISION_MODEL, {
        jsonMode: true, maxTokens: 500, temperature: 0.2, detail: 'auto',
      })
    )
    console.log('📥 Bird ID response:', response.substring(0, 300))

    const parsed = safeParseJSON(response)
    if (!parsed) {
      console.error('❌ Parse failed')
      throw new Error('AI returned an unparseable response. Please try again.')
    }

    const rawCandidates = (parsed.candidates && Array.isArray(parsed.candidates))
      ? parsed.candidates
          .filter((c: any) => c.species && typeof c.confidence === 'number' && c.confidence >= 0.3)
          .sort((a: any, b: any) => b.confidence - a.confidence)
          .slice(0, 5)
      : []

    // Ground candidate names against the eBird taxonomy
    const candidates = rawCandidates.map((c: any) => {
      const match = findBestMatch(c.species)
      if (match && match.common.toLowerCase() !== c.species.toLowerCase()) {
        console.log(`🔄 Grounded "${c.species}" → "${match.common}"`)
      }
      // Include scientific name in format "Common Name (Scientific Name)"
      const speciesName = match ? `${match.common} (${match.scientific})` : c.species
      return { ...c, species: speciesName }
    })
    console.log(`✅ ${candidates.length} candidates:`, candidates)

    let cropBox: BirdIdResult['cropBox'] = undefined
    // LLM returns birdCenter: [x%, y%] + birdSize — build a crop box around it
    const center = parsed.birdCenter
    if (Array.isArray(center) && center.length >= 2) {
      const cx = Number(center[0])
      const cy = Number(center[1])
      if (Number.isFinite(cx) && Number.isFinite(cy)) {
        const clampedCx = Math.max(0, Math.min(100, cx))
        const clampedCy = Math.max(0, Math.min(100, cy))
        // Scale crop based on bird size: small=40%, medium=55%, large=75%
        const sizePct = parsed.birdSize === 'large' ? 0.75
          : parsed.birdSize === 'medium' ? 0.55
          : 0.4
        const shortSide = Math.min(img.width, img.height)
        const cropPx = shortSide * sizePct
        const wPct = (cropPx / img.width) * 100
        const hPct = (cropPx / img.height) * 100
        const x = Math.max(0, Math.min(100 - wPct, clampedCx - wPct / 2))
        const y = Math.max(0, Math.min(100 - hPct, clampedCy - hPct / 2))
        cropBox = {
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(wPct),
          height: Math.round(hPct),
        }
        console.log(`✅ AI bird center: (${cx}, ${cy}) size=${parsed.birdSize} → crop`, cropBox)
      }
    }

    const multipleBirds = parsed.multipleBirds === true

    return { candidates, cropBox, multipleBirds }
  } catch (error) {
    console.error('❌ Bird ID error:', error)
    if (error instanceof Error) {
      if (error.message.includes('413') || error.message.includes('too large')) {
        const wrappedError = new Error('Image too large for API.') as Error & { cause?: unknown }
        wrappedError.cause = error
        throw wrappedError
      }
      if (error.message.includes('429') || error.message.includes('rate')) {
        const wrappedError = new Error('AI rate limit reached. Please wait a minute before trying again.') as Error & { cause?: unknown }
        wrappedError.cause = error
        throw wrappedError
      }
    }
    throw error
  }
}

/** Text-only LLM for non-vision tasks (location lookup, API test, etc.) */
export async function textLLM(prompt: string): Promise<string> {
  return sparkTextLLM(prompt, TEXT_MODEL, { maxTokens: 200, temperature: 0.3 })
}

export { VISION_MODEL, TEXT_MODEL }
