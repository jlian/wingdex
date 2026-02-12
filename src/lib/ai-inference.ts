import type { SpeciesSuggestion } from './types'

interface VisionResult {
  species: string
  confidence: number
}

export interface SuggestedCrop {
  x: number
  y: number
  width: number
  height: number
  confidence: number
}

export async function suggestBirdCrop(imageDataUrl: string): Promise<SuggestedCrop | null> {
  try {
    console.log('🔍 Starting AI crop suggestion...')
    
    const img = new Image()
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
      img.src = imageDataUrl
    })
    
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas not supported')
    
    const maxDim = 512
    const scale = Math.min(maxDim / Math.max(img.width, img.height), 1)
    canvas.width = img.width * scale
    canvas.height = img.height * scale
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const compressedImage = canvas.toDataURL('image/jpeg', 0.6)
    
    console.log(`📐 Image compressed from ${imageDataUrl.length} to ${compressedImage.length} bytes for crop detection`)
    
    const prompt = (window.spark.llmPrompt as any)`You are a computer vision expert specializing in bird photography. Analyze this image and identify the bounding box coordinates for the bird subject.

Look for:
- Any bird species in the image (even if partially visible or distant)
- The tightest rectangular area that contains the entire bird
- Consider the bird's body, head, tail, and wings

Return coordinates as percentages of the image dimensions (0-100).

If NO bird is visible, return null for cropBox.

Return ONLY valid JSON in this exact format:
{
  "cropBox": {
    "x": 25.5,
    "y": 30.2,
    "width": 45.0,
    "height": 40.8,
    "confidence": 0.85
  }
}

Where:
- x: left edge as % from left
- y: top edge as % from top  
- width: width as % of image width
- height: height as % of image height
- confidence: 0.0-1.0 how confident you are this contains a bird

Image to analyze: ${compressedImage}`

    console.log('📤 Sending crop detection request to Vision API (gpt-4o)...')
    const response = await window.spark.llm(prompt, 'gpt-4o', true)
    console.log('📥 Crop detection response:', response)
    
    const parsed = JSON.parse(response)
    
    if (parsed.cropBox && typeof parsed.cropBox.confidence === 'number' && parsed.cropBox.confidence >= 0.5) {
      console.log('✅ AI crop suggestion successful:', parsed.cropBox)
      return parsed.cropBox
    }
    
    console.log('⚠️ No confident crop suggestion found (confidence below 0.5)')
    return null
  } catch (error) {
    console.error('❌ Crop suggestion error:', error)
    if (error instanceof Error) {
      console.error('❌ Error message:', error.message)
      if (error.message.includes('token') || error.message.includes('quota') || error.message.includes('413')) {
        console.error('❌ Image too large for API - this should not happen with compression')
      }
    }
    return null
  }
}

export async function identifyBirdInPhoto(
  imageDataUrl: string,
  location?: { lat: number; lon: number },
  month?: number
): Promise<VisionResult[]> {
  try {
    console.log('🐦 Starting bird species identification...')
    
    const img = new Image()
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
      img.src = imageDataUrl
    })
    
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas not supported')
    
    const maxDim = 768
    const scale = Math.min(maxDim / Math.max(img.width, img.height), 1)
    canvas.width = img.width * scale
    canvas.height = img.height * scale
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const compressedImage = canvas.toDataURL('image/jpeg', 0.7)
    
    console.log(`📐 Image compressed from ${imageDataUrl.length} to ${compressedImage.length} bytes for bird ID`)
    
    let contextStr = ''
    
    if (location) {
      contextStr += ` The photo was taken at GPS coordinates ${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}.`
    }
    
    if (month !== undefined) {
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                         'July', 'August', 'September', 'October', 'November', 'December']
      contextStr += ` The photo was taken in ${monthNames[month]}.`
    }
    
    console.log('📍 Context:', contextStr || 'No GPS/date context')
    
    const prompt = (window.spark.llmPrompt as any)`You are an expert ornithologist with extensive knowledge of bird species worldwide. Carefully analyze this image to identify any bird species present.${contextStr}

IMPORTANT: Look closely at the entire image. Birds may be:
- In the center or edges of the frame
- Partially visible or partially obscured
- At various distances from the camera
- In any orientation or posture

Provide your top 5 most likely species identifications with confidence scores (0.0 to 1.0):
- Use confidence 0.8-1.0 for clear, definitive identifications
- Use confidence 0.5-0.79 for likely but uncertain identifications
- Use confidence 0.3-0.49 for possible identifications with ambiguity
- Only include species with at least 0.3 confidence

If NO bird is clearly visible in the image, return an empty candidates array.

Return ONLY a valid JSON object in this exact format (no additional text):
{
  "candidates": [
    {"species": "Common Name (Scientific name)", "confidence": 0.95}
  ]
}

Use standard common names followed by scientific names in parentheses (e.g., "American Robin (Turdus migratorius)").

Image to analyze: ${compressedImage}`
    
    console.log('📤 Sending bird ID request to Vision API (gpt-4o)...')
    const response = await window.spark.llm(prompt, 'gpt-4o', true)
    console.log('📥 Bird ID raw response:', response)
    
    const parsed = JSON.parse(response)
    console.log('📋 Parsed response:', parsed)
    
    if (parsed.candidates && Array.isArray(parsed.candidates)) {
      const filtered = parsed.candidates
        .filter((c: any) => c.species && typeof c.confidence === 'number' && c.confidence >= 0.3)
        .slice(0, 5)
      
      console.log(`✅ Found ${filtered.length} bird candidates:`, filtered)
      return filtered
    }
    
    console.log('⚠️ No valid candidates in response')
    return []
  } catch (error) {
    console.error('❌ AI inference error:', error)
    if (error instanceof Error) {
      console.error('❌ Error message:', error.message)
      console.error('❌ Error stack:', error.stack)
      
      if (error.message.includes('token') || error.message.includes('quota') || error.message.includes('413')) {
        console.error('❌ Image too large for API')
        throw new Error('Image too large. Please try with smaller images or fewer photos.')
      }
      if (error.message.includes('rate limit')) {
        console.error('❌ Rate limit exceeded - wait a moment and try again')
        throw new Error('Rate limit exceeded. Please wait a moment and try again.')
      }
    }
    throw error
  }
}

export function aggregateSpeciesSuggestions(
  photoResults: Map<string, VisionResult[]>
): SpeciesSuggestion[] {
  const speciesMap = new Map<string, {
    totalConfidence: number
    count: number
    supportingPhotos: string[]
  }>()
  
  for (const [photoId, results] of photoResults.entries()) {
    for (const result of results) {
      const existing = speciesMap.get(result.species)
      
      if (existing) {
        existing.totalConfidence += result.confidence
        existing.count++
        existing.supportingPhotos.push(photoId)
      } else {
        speciesMap.set(result.species, {
          totalConfidence: result.confidence,
          count: 1,
          supportingPhotos: [photoId]
        })
      }
    }
  }
  
  const suggestions: SpeciesSuggestion[] = []
  
  for (const [species, data] of speciesMap.entries()) {
    const avgConfidence = data.totalConfidence / data.count
    const frequencyBoost = Math.min(data.count / 5, 0.2)
    const finalConfidence = Math.min(avgConfidence + frequencyBoost, 1.0)
    
    suggestions.push({
      speciesName: species,
      confidence: finalConfidence,
      supportingPhotos: data.supportingPhotos,
      count: 1
    })
  }
  
  return suggestions.sort((a, b) => b.confidence - a.confidence)
}
