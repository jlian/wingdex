import { findBestMatch } from './taxonomy'

// GitHub Models via Spark proxy — use full owner/model format
const VISION_MODEL = 'openai/gpt-4.1'
const TEXT_MODEL = 'openai/gpt-4.1-mini'

interface VisionResult {
  species: string
  confidence: number
}

export interface BirdIdResult {
  candidates: VisionResult[]
  cropBox?: { x: number; y: number; width: number; height: number }
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

    let ctx = ''
    if (locationName) ctx += ` Location: ${locationName}.`
    if (location) ctx += ` GPS: ${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}.`
    if (month !== undefined) {
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      ctx += ` Month: ${months[month]}.`
    }

    const text = `Identify bird species in this photo.${ctx}
IMPORTANT: Only suggest species whose geographic range includes the specified location. Do not suggest species that are not found in the region. Pay close attention to species splits by region (e.g. Western vs Eastern Cattle-Egret).
If a bird is present, return your top candidate AND 1-3 alternative species that this bird could also be, even if you are fairly sure of the top pick. The top candidate MUST be first in the "candidates" array, and all candidates MUST be ordered by descending confidence. Consider similar-looking species, seasonal plumage variants, and regional subspecies as alternatives.
Also locate the bird and return a bounding box as percentage coordinates (0-100).
Return JSON: {"candidates":[{"species":"Common Kingfisher (Alcedo atthis)","confidence":0.85},{"species":"Blue-eared Kingfisher (Alcedo meninting)","confidence":0.5},{"species":"Indigo-banded Kingfisher (Ceyx melanurus)","confidence":0.35}],"cropBox":{"x":20,"y":25,"width":50,"height":45}}
Confidence: 0.85-1.0 definitive, 0.5-0.84 likely, 0.3-0.49 possible. Be conservative — only use 0.9+ when field marks are unambiguous.
The cropBox should be a GENEROUS box around the bird with some margin. Include head, tail, feet, wings with extra space.
No bird: {"candidates":[],"cropBox":null}`

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
      return { ...c, species: match ? match.common : c.species }
    })
    console.log(`✅ ${candidates.length} candidates:`, candidates)

    let cropBox: BirdIdResult['cropBox'] = undefined
    if (parsed.cropBox && typeof parsed.cropBox.x === 'number') {
      const { x, y, width, height } = parsed.cropBox
      if (x >= 0 && y >= 0 && width > 5 && height > 5 && x + width <= 101 && y + height <= 101) {
        cropBox = { x, y, width, height }
        console.log('✅ AI crop box:', cropBox)
      }
    }

    return { candidates, cropBox }
  } catch (error) {
    console.error('❌ Bird ID error:', error)
    if (error instanceof Error) {
      if (error.message.includes('413') || error.message.includes('too large'))
        throw new Error('Image too large for API.')
      if (error.message.includes('429') || error.message.includes('rate'))
        throw new Error('AI rate limit reached. Please wait a minute before trying again.')
    }
    throw error
  }
}

/** Text-only LLM for non-vision tasks (location lookup, API test, etc.) */
export async function textLLM(prompt: string): Promise<string> {
  return sparkTextLLM(prompt, TEXT_MODEL, { maxTokens: 200, temperature: 0.3 })
}

export { VISION_MODEL, TEXT_MODEL }
