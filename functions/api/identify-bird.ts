import { HttpError, identifyBird } from '../lib/bird-id'
import { RateLimitError, enforceAiDailyLimit } from '../lib/ai-rate-limit'

type BirdIdModelTier = 'fast' | 'strong'

function parseOptionalNumber(value: FormDataEntryValue | null): number | undefined {
  if (value == null) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

async function toImageDataUrl(image: FormDataEntryValue | null): Promise<string> {
  if (!image) {
    throw new HttpError(400, 'Missing image')
  }

  if (typeof image === 'string') {
    if (image.startsWith('data:image/')) return image
    throw new HttpError(400, 'Image string must be a data URL')
  }

  const buffer = await image.arrayBuffer()
  const base64 = Buffer.from(buffer).toString('base64')
  const mime = image.type || 'image/jpeg'
  return `data:${mime};base64,${base64}`
}

function parseModelTier(value: unknown): BirdIdModelTier {
  return value === 'strong' ? 'strong' : 'fast'
}

function validateMonth(month: number | undefined): number | undefined {
  if (month == null) return undefined
  if (!Number.isInteger(month) || month < 0 || month > 11) {
    throw new HttpError(400, 'month must be an integer between 0 and 11')
  }
  return month
}

export const onRequestPost: PagesFunction<Env> = async context => {
  const log = (context.data as RequestData).log
  const traceId = (context.data as RequestData).traceId
  const spanId = (context.data as RequestData).spanId
  try {
    const user = (context.data as { user?: { id?: string; isAnonymous?: boolean } }).user
    if (!user?.id) {
      return new Response('Unauthorized', { status: 401 })
    }

    if (user.isAnonymous) {
      return new Response('Account required', { status: 403 })
    }

    await enforceAiDailyLimit(context.env.DB, user.id, 'identify-bird', context.env.AI_DAILY_LIMIT_IDENTIFY)

    const contentType = context.request.headers.get('content-type') || ''

    let imageDataUrl: string
    let lat: number | undefined
    let lon: number | undefined
    let month: number | undefined
    let imageWidth: number | undefined
    let imageHeight: number | undefined
    let locationName: string | undefined
    let model: BirdIdModelTier = 'fast'

    if (contentType.includes('application/json')) {
      let body: {
        imageDataUrl?: unknown
        lat?: unknown
        lon?: unknown
        month?: unknown
        imageWidth?: unknown
        imageHeight?: unknown
        locationName?: unknown
        model?: unknown
      }
      try {
        body = await context.request.json() as {
          imageDataUrl?: unknown
          lat?: unknown
          lon?: unknown
          month?: unknown
          imageWidth?: unknown
          imageHeight?: unknown
          locationName?: unknown
          model?: unknown
        }
      } catch {
        throw new HttpError(400, 'Invalid JSON body')
      }

      const rawImageDataUrl = body.imageDataUrl
      if (typeof rawImageDataUrl !== 'string' || !rawImageDataUrl.startsWith('data:image/')) {
        throw new HttpError(400, 'imageDataUrl must be a data URL')
      }
      imageDataUrl = rawImageDataUrl

      lat = body.lat == null ? undefined : Number(body.lat)
      lon = body.lon == null ? undefined : Number(body.lon)
      month = body.month == null ? undefined : Number(body.month)
      imageWidth = body.imageWidth == null ? undefined : Number(body.imageWidth)
      imageHeight = body.imageHeight == null ? undefined : Number(body.imageHeight)
      locationName = String(body.locationName || '').trim() || undefined
      model = parseModelTier(body.model)

      lat = Number.isFinite(lat) ? lat : undefined
      lon = Number.isFinite(lon) ? lon : undefined
      month = Number.isFinite(month) ? month : undefined
      imageWidth = Number.isFinite(imageWidth) ? imageWidth : undefined
      imageHeight = Number.isFinite(imageHeight) ? imageHeight : undefined
    } else {
      const formData = await context.request.formData()
      imageDataUrl = await toImageDataUrl(formData.get('image'))
      lat = parseOptionalNumber(formData.get('lat'))
      lon = parseOptionalNumber(formData.get('lon'))
      month = parseOptionalNumber(formData.get('month'))
      imageWidth = parseOptionalNumber(formData.get('imageWidth'))
      imageHeight = parseOptionalNumber(formData.get('imageHeight'))
      locationName = String(formData.get('locationName') || '').trim() || undefined
      model = parseModelTier(formData.get('model'))
    }

    month = validateMonth(month)

    const result = await identifyBird(context.env, {
      imageDataUrl,
      imageWidth,
      imageHeight,
      location: lat !== undefined && lon !== undefined ? { lat, lon } : undefined,
      month,
      locationName,
      modelTier: model,
    }, log, traceId, spanId)

    return Response.json(result)
  } catch (error) {
    if (error instanceof RateLimitError) {
      log?.warn('birdId.identify.rateLimited', { resultType: 'Failed', resultSignature: 429, resultDescription: `Bird identification rate-limited: ${error.message}; retry after ${error.retryAfterSeconds}s`, properties: { retryAfterSeconds: error.retryAfterSeconds } })
      return new Response(error.message, {
        status: error.status,
        headers: {
          'Retry-After': String(error.retryAfterSeconds),
        },
      })
    }

    if (error instanceof HttpError) {
      log?.warn('birdId.identify.failed', { resultType: 'Failed', resultSignature: error.status, resultDescription: `Bird identification failed: ${error.message}` })
      return new Response(error.message, { status: error.status })
    }

    if (error instanceof Error) {
      log?.error('birdId.identify.failed', { resultType: 'Failed', resultDescription: `Bird identification failed unexpectedly: ${error.message}`, properties: { error: error.message, stack: error.stack } })
    } else {
      log?.error('birdId.identify.failed', { resultType: 'Failed', resultDescription: `Bird identification failed with non-Error value: ${String(error)}`, properties: { error: String(error) } })
    }

    return new Response('An unexpected error occurred during bird identification', { status: 500 })
  }
}
