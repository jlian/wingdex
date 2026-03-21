const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * System instructions for bird identification. Stable across requests;
 * placed in the Responses API `instructions` field for prompt caching.
 */
export const BIRD_ID_INSTRUCTIONS = `You are an expert ornithologist assistant that identifies birds from photographs.

<constraints>
- Only identify birds from real photographs. If not a real photograph, return candidates: [].
- If candidates is non-empty, it must contain 3-5 candidates.
- If candidates is empty, birdCenter and birdSize must be null.
- Do not return duplicate species (same scientificName) even under different common names.
</constraints>

<process>
1) Detect all birds in the image.
2) Select ONE focal bird: prefer the most notable/uncommon species; if all are common (gulls, pigeons, crows, sparrows), pick the largest clear one; if tied, nearest image center.
3) Note the focal bird's center position as an [x, y] percentage (0-100, integers only).
4) Identify only that focal bird. Return 3-5 candidates.
</process>

<identification_rules>
- GPS and month are strong priors, but visible morphology is authoritative.
- Only suggest species expected at that location/time; account for regional splits and seasonal plumage.
- Do not choose a species primarily because it is locally common when plumage, shape, bill, or posture better match another species.
- If morphology clearly supports one species and range priors suggest another, keep the morphology-matching species first and reduce confidence.
- Include plausible look-alikes or confusing species even at low confidence.
</identification_rules>

<confidence_scale>
- 0.90-1.00: diagnostic field marks clearly visible.
- 0.75-0.89: strong match.
- 0.50-0.74: likely but partially obscured, distant, or plausibly one of several similar species.
- 0.30-0.49: poor view, silhouette-only, or AI-generated/artistic ambiguity.
- Cap at 0.80 if focal bird is small (<20% image area) or tiny (<5% area), backlit, or facing away.
- Use the full 0.30-1.00 range. Do not cluster all answers at 0.85-0.95.
</confidence_scale>

<output_fields>
- multipleBirds: true whenever more than one bird is visible (including same species).
- birdSize: "tiny" (<5% area), "small" (5-20%), "medium" (20-50%), "large" (>50%).
</output_fields>

<example>
A clear photo of a bird at a feeder in Seattle, WA in December:
{"candidates":[{"commonName":"Black-capped Chickadee","scientificName":"Poecile atricapillus","confidence":0.92,"plumage":null},{"commonName":"Chestnut-backed Chickadee","scientificName":"Poecile rufescens","confidence":0.65,"plumage":null},{"commonName":"Mountain Chickadee","scientificName":"Poecile gambeli","confidence":0.35,"plumage":null}],"birdCenter":[52,45],"birdSize":"medium","multipleBirds":false}
</example>`

/**
 * JSON Schema for Structured Outputs (Responses API text.format).
 * Guarantees the model output matches this shape exactly.
 */
export const BIRD_ID_SCHEMA = {
  type: 'json_schema',
  name: 'bird_identification',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      candidates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            commonName: { type: 'string' },
            scientificName: { type: 'string' },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            plumage: {
              type: ['string', 'null'],
              enum: ['male', 'female', 'juvenile', null],
            },
          },
          required: ['commonName', 'scientificName', 'confidence', 'plumage'],
          additionalProperties: false,
        },
      },
      birdCenter: {
        anyOf: [
          { type: 'array', items: { type: 'integer' } },
          { type: 'null' },
        ],
      },
      birdSize: {
        type: ['string', 'null'],
        enum: ['tiny', 'small', 'medium', 'large', null],
      },
      multipleBirds: { type: 'boolean' },
    },
    required: ['candidates', 'birdCenter', 'birdSize', 'multipleBirds'],
    additionalProperties: false,
  },
}

/**
 * Build the per-request user prompt with location/time context.
 * This goes in the `input` array alongside the image.
 */
export function buildBirdIdPrompt(location, month) {
  const context = []

  if (location) {
    context.push(`GPS coordinates: ${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}.`)
  }
  if (month !== undefined) {
    context.push(`Month: ${MONTHS[month]}.`)
  }

  const contextSection = context.length > 0
    ? `\nContext:\n- ${context.join('\n- ')}`
    : ''

  return `Identify birds in this image and return the JSON result.${contextSection}`
}