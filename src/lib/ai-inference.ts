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
      contextStr += ` Location: ${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}.`
    }
    
    if (month !== undefined) {
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                         'July', 'August', 'September', 'October', 'November', 'December']
      contextStr += ` Month: ${monthNames[month]}.`
    }
    
    const base64Data = imageDataUrl.split(',')[1]
    
    const prompt = `You are an expert ornithologist. Analyze this image and identify any bird species present.${contextStr}

Return the top 5 most likely bird species with confidence scores (0.0 to 1.0). If no bird is visible, return an empty array.

Return ONLY a JSON object in this exact format:
{
  "candidates": [
    {"species": "Common Name (Scientific name)", "confidence": 0.95},
    {"species": "Another Bird (Scientific name)", "confidence": 0.75}
  ]
}

Use standard common names followed by scientific names in parentheses. Be conservative with confidence scores.

[Image data: data:image/jpeg;base64,${base64Data.substring(0, 100)}...]`
    
    const response = await window.spark.llm(prompt, 'gpt-4o', true)
    const parsed = JSON.parse(response)
    
    if (parsed.candidates && Array.isArray(parsed.candidates)) {
      return parsed.candidates
        .filter((c: any) => c.species && typeof c.confidence === 'number')
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
