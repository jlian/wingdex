import type { SpeciesSuggestion } from './types'

interface VisionResult {
  species: string
  confidence: number
}

export async function identifyBirdInPhoto(
  imageDataUrl: string,
  location?: { lat: number; lon: number },
  month?: number
): Promise<VisionResult[]> {
  try {
    let contextStr = ''
    
    if (location) {
      contextStr += ` The photo was taken at GPS coordinates ${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}.`
    }
    
    if (month !== undefined) {
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                         'July', 'August', 'September', 'October', 'November', 'December']
      contextStr += ` The photo was taken in ${monthNames[month]}.`
    }
    
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

Image to analyze: ${imageDataUrl}`
    
    const response = await window.spark.llm(prompt, 'gpt-4o', true)
    const parsed = JSON.parse(response)
    
    if (parsed.candidates && Array.isArray(parsed.candidates)) {
      return parsed.candidates
        .filter((c: any) => c.species && typeof c.confidence === 'number' && c.confidence >= 0.3)
        .slice(0, 5)
    }
    
    return []
  } catch (error) {
    console.error('AI inference error:', error)
    return []
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
