import { fetchWithLocalAuthRetry } from '@/lib/local-auth-fetch'

interface VisionResult {
  species: string
  confidence: number
  wikiTitle?: string
}

export type BirdIdModelTier = 'fast' | 'strong'

export interface BirdIdResult {
  candidates: VisionResult[]
  cropBox?: { x: number; y: number; width: number; height: number }
  multipleBirds?: boolean
}

function compressImage(img: HTMLImageElement, maxDim: number, quality: number): { dataUrl: string; width: number; height: number } {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported')

  const scale = Math.min(maxDim / Math.max(img.width, img.height), 1)
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  return {
    dataUrl: canvas.toDataURL('image/jpeg', quality),
    width: canvas.width,
    height: canvas.height,
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

export async function identifyBirdInPhoto(
  imageDataUrl: string,
  location?: { lat: number; lon: number },
  month?: number,
  locationName?: string,
  model: BirdIdModelTier = 'fast',
): Promise<BirdIdResult> {
  const image = await loadImage(imageDataUrl)
  const compressed = compressImage(image, 640, 0.7)

  const requestPayload: {
    imageDataUrl: string
    imageWidth: number
    imageHeight: number
    lat?: number
    lon?: number
    month?: number
    locationName?: string
    model: BirdIdModelTier
  } = {
    imageDataUrl: compressed.dataUrl,
    imageWidth: compressed.width,
    imageHeight: compressed.height,
    model,
  }

  if (location) {
    requestPayload.lat = location.lat
    requestPayload.lon = location.lon
  }
  if (month !== undefined) {
    requestPayload.month = month
  }
  if (locationName) {
    requestPayload.locationName = locationName
  }

  const response = await fetchWithLocalAuthRetry('/api/identify-bird', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestPayload),
  })

  if (!response.ok) {
    const message = await response.text()
    if (response.status === 413 || message.toLowerCase().includes('too large')) {
      throw new Error('Image too large for API.')
    }
    if (response.status === 429 || message.toLowerCase().includes('rate')) {
      throw new Error('AI rate limit reached. Please wait a minute before trying again.')
    }
    throw new Error(`LLM ${response.status}: ${message.substring(0, 300)}`)
  }

  const payload = await response.json() as BirdIdResult
  return {
    candidates: Array.isArray(payload?.candidates) ? payload.candidates : [],
    cropBox: payload?.cropBox,
    multipleBirds: payload?.multipleBirds === true,
  }
}
