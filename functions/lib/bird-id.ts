import { findBestMatch, getWikiTitle } from './taxonomy'
import { buildBirdIdPrompt, BIRD_ID_INSTRUCTIONS, BIRD_ID_SCHEMA } from './bird-id-prompt.js'
import { HttpError } from './http-error'
import { safeParseJSON, extractAssistantContent, buildCropBox } from './bird-id-helpers'
import { getRangePriors, adjustConfidence } from './range-filter'
import type { Logger } from './log'
import { formatTraceparent, randomSpanId } from './trace-context'


export const VISION_MODEL = 'gpt-5.4-mini'
export const VISION_MODEL_STRONG = 'gpt-5.4-mini'

type Candidate = {
  species: string
  confidence: number
  wikiTitle?: string
  plumage?: string
  rangeStatus?: 'present' | 'near-range' | 'out-of-range' | 'no-data'
}

type IdentifyBirdResult = {
  candidates: Candidate[]
  cropBox?: { x: number; y: number; width: number; height: number }
  multipleBirds?: boolean
  rangeAdjusted?: boolean
}

type IdentifyBirdInput = {
  imageDataUrl: string
  imageWidth?: number
  imageHeight?: number
  location?: { lat: number; lon: number }
  month?: number
  locationName?: string
  modelTier?: 'fast' | 'strong'
}

export { HttpError } from './http-error'

async function callOpenAI(env: Env, body: unknown, traceId?: string, spanId?: string): Promise<string> {
  if (!env.CF_ACCOUNT_ID || !env.AI_GATEWAY_ID) {
    throw new HttpError(503, 'CF_ACCOUNT_ID and AI_GATEWAY_ID are required')
  }
  if (!env.OPENAI_API_KEY) {
    throw new HttpError(503, 'OPENAI_API_KEY is not configured')
  }

  const url = `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/openai/responses`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    ...(env.CF_AIG_TOKEN ? { 'cf-aig-authorization': `Bearer ${env.CF_AIG_TOKEN}` } : {}),
    ...(traceId && spanId ? { traceparent: formatTraceparent(traceId, randomSpanId(), '01') } : {}),
  }
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new HttpError(response.status, `LLM ${response.status}: ${text.substring(0, 300)}`)
  }

  const payload = await response.json() as any
  return extractAssistantContent(payload)
}

function isReasoningModel(model: string): boolean {
  const normalized = model.toLowerCase()
  return normalized.includes('gpt-5') || normalized.startsWith('o1') || normalized.startsWith('o3') || normalized.startsWith('o4')
}

function withSamplingOptions(model: string): { temperature?: number; top_p?: number } {
  if (isReasoningModel(model)) {
    return {}
  }

  return {
    temperature: 0.2,
    top_p: 1.0,
  }
}

export async function identifyBird(env: Env, input: IdentifyBirdInput, log?: Logger, traceId?: string, spanId?: string): Promise<IdentifyBirdResult> {
  const prompt = buildBirdIdPrompt(input.location, input.month)

  const parseIdentifyResponse = async (model: string): Promise<any> => {
    const buildVisionBody = () => ({
      model,
      store: false,
      ...withSamplingOptions(model),
      ...(isReasoningModel(model) ? { reasoning: { effort: input.modelTier === 'strong' ? 'low' as const : 'none' as const } } : {}),
      max_output_tokens: 600,
      text: { format: BIRD_ID_SCHEMA },
      instructions: BIRD_ID_INSTRUCTIONS,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: input.imageDataUrl, detail: 'high' },
          ],
        },
      ],
    })

    const content = await callOpenAI(env, buildVisionBody(), traceId, spanId)
    const parsed = safeParseJSON(content)

    if (!parsed) {
      throw new HttpError(502, `AI returned an unparseable response: ${content.substring(0, 200)}`)
    }

    return parsed
  }

  const model = input.modelTier === 'strong'
    ? (env.OPENAI_MODEL_STRONG || VISION_MODEL_STRONG)
    : (env.OPENAI_MODEL || VISION_MODEL)
  const parsed = await parseIdentifyResponse(model)

  log?.debug('birdId.llmRawCandidates', { category: 'BirdId', resultDescription: `LLM returned ${Array.isArray(parsed.candidates) ? parsed.candidates.length : 0} raw candidates`, properties: { candidates: parsed.candidates } })

  let candidates = (Array.isArray(parsed.candidates) ? parsed.candidates : [])
    .map((candidate: any) => ({
      commonName: String(candidate?.commonName || candidate?.species || ''),
      scientificName: String(candidate?.scientificName || ''),
      confidence: Number(candidate?.confidence),
      plumage: typeof candidate?.plumage === 'string' && candidate.plumage ? candidate.plumage : undefined,
    }))
    .filter(candidate => (candidate.commonName || candidate.scientificName) && Number.isFinite(candidate.confidence) && candidate.confidence >= 0.2)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5)
    .flatMap(candidate => {
      const lookupName = candidate.scientificName
        ? `${candidate.commonName} (${candidate.scientificName})`
        : candidate.commonName
      const match = findBestMatch(lookupName)
      if (!match) return []
      const species = `${match.common} (${match.scientific})`

      return [{
        species,
        confidence: candidate.confidence,
        wikiTitle: getWikiTitle(match.common),
        ebirdCode: match.ebirdCode || '',
        plumage: candidate.plumage,
      }]
    })

  // Dedup by species (LLM may return same species under different common names)
  const seen = new Set<string>()
  candidates = candidates.filter(c => {
    if (seen.has(c.species)) return false
    seen.add(c.species)
    return true
  })

  log?.debug('birdId.taxonomyMatch', { category: 'BirdId', resultDescription: `${candidates.length} candidates survived taxonomy matching`, properties: { candidates: candidates.map(c => ({ species: c.species, confidence: c.confidence, plumage: c.plumage ?? null, code: c.ebirdCode })) } })

  // Apply range-prior adjustment if location is available
  const hasRangeBucket = env.RANGE_PRIORS != null
  log?.debug('birdId.rangeFilter', { category: 'BirdId', resultDescription: `Range filter: location=${input.location ? 'present' : 'absent'}, R2 bucket=${hasRangeBucket ? 'available' : 'unavailable'}`, properties: { location: input.location ? `${input.location.lat},${input.location.lon}` : 'none', bucket: hasRangeBucket } })

  let rangeAdjusted = false

  if (input.location && env.RANGE_PRIORS) {
    const codes = candidates.map(c => c.ebirdCode).filter(Boolean)
    const priors = await getRangePriors(
      env.RANGE_PRIORS,
      input.location.lat,
      input.location.lon,
      input.month,
      codes,
    )
    log?.debug('birdId.rangePriors', { category: 'BirdId', resultDescription: `Retrieved range priors for ${codes.length} species`, properties: { priors: Object.fromEntries(priors) } })
    rangeAdjusted = [...priors.values()].some(r => r.status !== 'no-data')
    candidates = candidates.map(c => {
      const range = priors.get(c.ebirdCode)
      if (!range) return c
      return { ...c, confidence: adjustConfidence(c.confidence, range, input.month, input.location!.lat), rangeStatus: range.status }
    })
    candidates.sort((a, b) => b.confidence - a.confidence)
    log?.debug('birdId.rangeAdjusted', { category: 'BirdId', resultDescription: `Confidence adjusted by range priors for ${candidates.length} candidates`, properties: { candidates: candidates.map(c => ({ species: c.species, confidence: c.confidence, range: c.rangeStatus ?? 'n/a' })) } })
  }

  const result = {
    candidates: candidates.map(({ ebirdCode: _, plumage, ...rest }) => ({
      ...rest,
      ...(plumage ? { plumage } : {}),
    })),
    cropBox: buildCropBox(parsed.birdCenter, parsed.birdSize, input.imageWidth, input.imageHeight),
    multipleBirds: parsed.multipleBirds === true,
    ...(rangeAdjusted ? { rangeAdjusted: true } : {}),
  }
  log?.debug('birdId.finalResponse', { category: 'BirdId', resultDescription: `Returning ${result.candidates.length} candidates, multipleBirds=${result.multipleBirds ?? false}, rangeAdjusted=${result.rangeAdjusted ?? false}`, properties: { candidateCount: result.candidates.length, multipleBirds: result.multipleBirds, rangeAdjusted: result.rangeAdjusted } })
  return result
}