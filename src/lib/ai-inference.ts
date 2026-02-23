import { fetchWithLocalAuthRetry } from '@/lib/local-auth-fetch'

interface VisionResult {
  species: string
  confidence: number
  wikiTitle?: string
}

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

function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',')
  if (parts.length !== 2) {
    throw new Error('Invalid image data URL')
  }

  const mimeMatch = parts[0].match(/data:(.*?);base64/)
  const mime = mimeMatch?.[1] || 'image/jpeg'
  const binary = atob(parts[1])
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }

  return new Blob([bytes], { type: mime })
}

export async function identifyBirdInPhoto(
  imageDataUrl: string,
  location?: { lat: number; lon: number },
  month?: number,
  locationName?: string,
): Promise<BirdIdResult> {
  const image = await loadImage(imageDataUrl)
  const compressed = compressImage(image, 640, 0.7)

  const formData = new FormData()
  formData.append('image', dataUrlToBlob(compressed.dataUrl), 'bird.jpg')
  formData.append('imageWidth', String(compressed.width))
  formData.append('imageHeight', String(compressed.height))
  if (location) {
    formData.append('lat', String(location.lat))
    formData.append('lon', String(location.lon))
  }
  if (month !== undefined) {
    formData.append('month', String(month))
  }
  if (locationName) {
    formData.append('locationName', locationName)
  }

  const response = await fetchWithLocalAuthRetry('/api/identify-bird', {
    method: 'POST',
    credentials: 'include',
    body: formData,
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
