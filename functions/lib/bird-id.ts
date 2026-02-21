import { findBestMatch, getWikiTitle } from './taxonomy'

const DEFAULT_OPENAI_MODEL = 'gpt-5-mini'
const DEFAULT_AZURE_API_VERSION = '2024-10-21'
const DEFAULT_GITHUB_MODELS_ENDPOINT = 'https://models.github.ai/inference/chat/completions'

function resolveModel(env: Env): string {
  const provider = resolveProvider(env)

  if (provider === 'azure') {
    return env.AZURE_OPENAI_DEPLOYMENT || env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL
  }

  if (provider === 'github') {
    const model = env.GITHUB_MODELS_MODEL || env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL
    return model.includes('/') ? model : `openai/${model}`
  }

  return env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL
}

function resolveProvider(env: Env): 'openai' | 'azure' | 'github' {
  const provider = (env.LLM_PROVIDER || 'openai').toLowerCase()
  if (provider === 'azure') return 'azure'
  if (provider === 'github') return 'github'
  return 'openai'
}

type Candidate = {
  species: string
  confidence: number
  wikiTitle?: string
}

export type IdentifyBirdResult = {
  candidates: Candidate[]
  cropBox?: { x: number; y: number; width: number; height: number }
  multipleBirds?: boolean
}

export type IdentifyBirdInput = {
  imageDataUrl: string
  imageWidth?: number
  imageHeight?: number
  location?: { lat: number; lon: number }
  month?: number
  locationName?: string
}

export class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function safeParseJSON(text: string): any {
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

function extractAssistantContent(payload: any): string {
  const message = payload?.choices?.[0]?.message
  const content = message?.content

  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    const joined = content
      .map((part: any) => {
        if (typeof part === 'string') return part
        if (typeof part?.text === 'string') return part.text
        if (typeof part?.text?.value === 'string') return part.text.value
        if (part?.type === 'output_text' && typeof part?.content === 'string') return part.content
        if (typeof part?.content === 'string') return part.content
        return ''
      })
      .filter(Boolean)
      .join('\n')

    if (joined) return joined
  }

  if (typeof message?.refusal === 'string' && message.refusal) {
    return message.refusal
  }

  if (content && typeof content === 'object') {
    try {
      return JSON.stringify(content)
    } catch {}
  }

  return ''
}

function buildVisionPrompt(location?: { lat: number; lon: number }, month?: number, locationName?: string): string {
  const context: string[] = []

  if (location) {
    context.push(`Primary geolocation (authoritative): GPS ${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}.`)
  }
  if (locationName) {
    context.push(`Place label (secondary, may be noisy): ${locationName}.`)
  }
  if (month !== undefined) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    context.push(`Month: ${months[month]}.`)
  }

  const contextSection = context.length > 0
    ? `\nContext:\n- ${context.join('\n- ')}`
    : ''

  return `Identify birds in this image and return ONE JSON object only.${contextSection}

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
}

async function callOpenAI(env: Env, body: unknown): Promise<string> {
  const provider = resolveProvider(env)
  let url = ''
  let headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  let requestBody = body as Record<string, unknown>

  if (provider === 'azure') {
    if (!env.AZURE_OPENAI_ENDPOINT || !env.AZURE_OPENAI_API_KEY || !env.AZURE_OPENAI_DEPLOYMENT) {
      throw new HttpError(503, 'Azure OpenAI is not fully configured')
    }

    const endpoint = env.AZURE_OPENAI_ENDPOINT.replace(/\/$/, '')
    if (endpoint.endsWith('/openai/v1')) {
      url = `${endpoint}/chat/completions`
      headers.Authorization = `Bearer ${env.AZURE_OPENAI_API_KEY}`
    } else {
      const apiVersion = env.AZURE_OPENAI_API_VERSION || DEFAULT_AZURE_API_VERSION
      url = `${endpoint}/openai/deployments/${env.AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`
      headers['api-key'] = env.AZURE_OPENAI_API_KEY

      const { model: _dropModel, ...azureBody } = requestBody
      requestBody = azureBody
    }
  } else if (provider === 'github') {
    if (!env.GITHUB_MODELS_TOKEN) {
      throw new HttpError(503, 'GITHUB_MODELS_TOKEN is not configured')
    }

    url = env.GITHUB_MODELS_ENDPOINT || DEFAULT_GITHUB_MODELS_ENDPOINT
    headers.Accept = 'application/vnd.github+json'
    headers['X-GitHub-Api-Version'] = '2022-11-28'
    headers.Authorization = `Bearer ${env.GITHUB_MODELS_TOKEN}`
  } else {
    if (!env.OPENAI_API_KEY) {
      throw new HttpError(503, 'OPENAI_API_KEY is not configured')
    }

    const useGateway = Boolean(env.AI_GATEWAY_ID) && Boolean(env.CF_ACCOUNT_ID)
    url = useGateway
      ? `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/openai/chat/completions`
      : 'https://api.openai.com/v1/chat/completions'
    headers.Authorization = `Bearer ${env.OPENAI_API_KEY}`
  }

  const sendRequest = async (payload: Record<string, unknown>) => fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  const swapTokenParam = (payload: Record<string, unknown>, from: 'max_tokens' | 'max_completion_tokens', to: 'max_tokens' | 'max_completion_tokens') => {
    if (payload[from] === undefined || payload[to] !== undefined) return null

    const nextPayload = { ...payload }
    nextPayload[to] = nextPayload[from]
    delete nextPayload[from]
    return nextPayload
  }

  const extractUnsupportedParam = (errorText: string): string | null => {
    const parsed = safeParseJSON(errorText)
    if (typeof parsed?.error?.param === 'string' && parsed.error.param.length > 0) {
      return parsed.error.param
    }

    const match = errorText.match(/Unsupported (?:parameter|value):\s*'([^']+)'/i)
    return match?.[1] || null
  }

  const removeParam = (payload: Record<string, unknown>, param: string) => {
    if (!(param in payload)) return null

    const nextPayload = { ...payload }
    delete nextPayload[param]
    return nextPayload
  }

  let response: Response | null = null
  let currentBody = requestBody

  for (let attempt = 0; attempt < 3; attempt++) {
    response = await sendRequest(currentBody)
    if (response.ok) break

    if (response.status !== 400) {
      const text = await response.text()
      throw new HttpError(response.status, `LLM ${response.status}: ${text.substring(0, 300)}`)
    }

    const errorText = await response.text()
    const lower = errorText.toLowerCase()

    const tokenSwapFallback = lower.includes('unsupported parameter') && lower.includes('max_tokens')
      ? swapTokenParam(currentBody, 'max_tokens', 'max_completion_tokens')
      : lower.includes('unsupported parameter') && lower.includes('max_completion_tokens')
        ? swapTokenParam(currentBody, 'max_completion_tokens', 'max_tokens')
        : null

    if (tokenSwapFallback) {
      currentBody = tokenSwapFallback
      continue
    }

    const unsupportedParam = extractUnsupportedParam(errorText)
    if (unsupportedParam) {
      const paramFallback = removeParam(currentBody, unsupportedParam)
      if (paramFallback) {
        currentBody = paramFallback
        continue
      }
    }

    throw new HttpError(response.status, `LLM ${response.status}: ${errorText.substring(0, 300)}`)
  }

  if (!response) {
    throw new HttpError(500, 'LLM request failed before a response was received')
  }

  if (!response.ok) {
    const text = await response.text()
    throw new HttpError(response.status, `LLM ${response.status}: ${text.substring(0, 300)}`)
  }

  const payload = await response.json() as any
  return extractAssistantContent(payload)
}

function shouldUseMaxCompletionTokens(model: string): boolean {
  const normalized = model.toLowerCase()
  return normalized.includes('gpt-5') || normalized.startsWith('o1') || normalized.startsWith('o3') || normalized.startsWith('o4')
}

function shouldUseDefaultSampling(model: string): boolean {
  return shouldUseMaxCompletionTokens(model)
}

function withTokenLimit(model: string, maxTokens: number): { max_tokens?: number; max_completion_tokens?: number } {
  if (shouldUseMaxCompletionTokens(model)) {
    return { max_completion_tokens: maxTokens }
  }

  return { max_tokens: maxTokens }
}

function withSamplingOptions(model: string): { temperature?: number; top_p?: number } {
  if (shouldUseDefaultSampling(model)) {
    return {}
  }

  return {
    temperature: 0.2,
    top_p: 1.0,
  }
}

function buildCropBox(
  birdCenter: unknown,
  birdSize: unknown,
  imageWidth?: number,
  imageHeight?: number,
): IdentifyBirdResult['cropBox'] {
  if (!Array.isArray(birdCenter) || birdCenter.length < 2) return undefined

  const cx = Number(birdCenter[0])
  const cy = Number(birdCenter[1])
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return undefined

  const clampedCx = Math.max(0, Math.min(100, cx))
  const clampedCy = Math.max(0, Math.min(100, cy))

  const sizePct = birdSize === 'large' ? 0.75 : birdSize === 'medium' ? 0.55 : 0.4

  if (imageWidth && imageHeight && imageWidth > 0 && imageHeight > 0) {
    const shortSide = Math.min(imageWidth, imageHeight)
    const cropPx = shortSide * sizePct
    const wPct = (cropPx / imageWidth) * 100
    const hPct = (cropPx / imageHeight) * 100
    const x = Math.max(0, Math.min(100 - wPct, clampedCx - wPct / 2))
    const y = Math.max(0, Math.min(100 - hPct, clampedCy - hPct / 2))
    return {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(wPct),
      height: Math.round(hPct),
    }
  }

  const pct = Math.round(sizePct * 100)
  const x = Math.max(0, Math.min(100 - pct, clampedCx - pct / 2))
  const y = Math.max(0, Math.min(100 - pct, clampedCy - pct / 2))

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: pct,
    height: pct,
  }
}

export async function identifyBird(env: Env, input: IdentifyBirdInput): Promise<IdentifyBirdResult> {
  const prompt = buildVisionPrompt(input.location, input.month, input.locationName)
  const parseIdentifyResponse = async (model: string): Promise<any> => {
    const buildVisionBody = (strictJsonOnly: boolean, forceTextMode: boolean) => ({
      model,
      ...withSamplingOptions(model),
      ...withTokenLimit(model, 2000),
      ...(forceTextMode ? {} : { response_format: { type: 'json_object' as const } }),
      messages: [
        {
          role: 'system',
          content: strictJsonOnly
            ? 'You are an expert ornithologist assistant. Return exactly one valid JSON object. No markdown, no prose, no extra keys.'
            : 'You are an expert ornithologist assistant. Return only what is asked.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: input.imageDataUrl, detail: 'auto' } },
          ],
        },
      ],
    })

    const callVision = async (strictJsonOnly: boolean, forceTextMode = false) => callOpenAI(
      env,
      buildVisionBody(strictJsonOnly, forceTextMode),
    )

    const content = await callVision(false)

    let parsed = safeParseJSON(content)
    let sourceForRepair = content

    if (!parsed) {
      const strictContent = await callVision(true)
      parsed = safeParseJSON(strictContent)
      sourceForRepair = strictContent || content
    }

    if (!parsed) {
      const strictTextModeContent = await callVision(true, true)
      parsed = safeParseJSON(strictTextModeContent)
      sourceForRepair = strictTextModeContent || sourceForRepair
    }

    if (!parsed && sourceForRepair.trim()) {
      const repaired = await callOpenAI(env, {
        model,
        ...withSamplingOptions(model),
        ...withTokenLimit(model, 1000),
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Normalize the input into strict JSON with shape: {"candidates":[{"species":"Common Name (Scientific name)","confidence":0.0}],"birdCenter":[0,0]|null,"birdSize":"small|medium|large|null","multipleBirds":boolean}. Return only JSON.',
          },
          {
            role: 'user',
            content: `Convert this bird-identification output to the required JSON schema:\n\n${sourceForRepair}`,
          },
        ],
      })

      parsed = safeParseJSON(repaired)
    }

    if (!parsed) {
      throw new HttpError(502, `AI returned an unparseable response: ${sourceForRepair.substring(0, 200)}`)
    }

    return parsed
  }

  const model = resolveModel(env)
  const parsed = await parseIdentifyResponse(model)

  const candidates = (Array.isArray(parsed.candidates) ? parsed.candidates : [])
    .map((candidate: any) => ({
      species: String(candidate?.species || ''),
      confidence: Number(candidate?.confidence),
    }))
    .filter(candidate => candidate.species && Number.isFinite(candidate.confidence) && candidate.confidence >= 0.3)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5)
    .map(candidate => {
      const match = findBestMatch(candidate.species)
      const species = match
        ? `${match.common} (${match.scientific})`
        : candidate.species

      return {
        species,
        confidence: candidate.confidence,
        wikiTitle: match ? getWikiTitle(match.common) : undefined,
      }
    })

  return {
    candidates,
    cropBox: buildCropBox(parsed.birdCenter, parsed.birdSize, input.imageWidth, input.imageHeight),
    multipleBirds: parsed.multipleBirds === true,
  }
}

export async function suggestLocationName(
  env: Env,
  input: { lat?: number; lon?: number; existingNames?: string[]; prompt?: string },
): Promise<{ name: string; text: string }> {
  const model = resolveModel(env)
  const hasCoordinates = Number.isFinite(input.lat) && Number.isFinite(input.lon)

  const userPrompt = input.prompt || (hasCoordinates
    ? `Suggest a concise birding location name for coordinates ${input.lat}, ${input.lon}. Return plain text only.`
    : 'Return "API is working".')

  const existingNamesHint = input.existingNames?.length
    ? ` Existing place names: ${input.existingNames.join(', ')}.`
    : ''

  const content = await callOpenAI(env, {
    model,
    ...withSamplingOptions(model),
    ...withTokenLimit(model, 120),
    response_format: { type: 'text' },
    messages: [
      { role: 'system', content: 'You provide concise location names. Return plain text only.' },
      { role: 'user', content: `${userPrompt}${existingNamesHint}` },
    ],
  })

  const text = content.trim().replace(/^"|"$/g, '')
  return { name: text, text }
}