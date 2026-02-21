import { HttpError, identifyBird } from '../lib/bird-id'

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

export const onRequestPost: PagesFunction<Env> = async context => {
  try {
    const formData = await context.request.formData()
    const imageDataUrl = await toImageDataUrl(formData.get('image'))
    const lat = parseOptionalNumber(formData.get('lat'))
    const lon = parseOptionalNumber(formData.get('lon'))
    const month = parseOptionalNumber(formData.get('month'))
    const imageWidth = parseOptionalNumber(formData.get('imageWidth'))
    const imageHeight = parseOptionalNumber(formData.get('imageHeight'))
    const locationName = String(formData.get('locationName') || '').trim() || undefined

    const result = await identifyBird(context.env, {
      imageDataUrl,
      imageWidth,
      imageHeight,
      location: lat !== undefined && lon !== undefined ? { lat, lon } : undefined,
      month,
      locationName,
    })

    return Response.json(result)
  } catch (error) {
    if (error instanceof HttpError) {
      return new Response(error.message, { status: error.status })
    }

    const message = error instanceof Error ? error.message : 'Bird identification failed'
    return new Response(message, { status: 500 })
  }
}
