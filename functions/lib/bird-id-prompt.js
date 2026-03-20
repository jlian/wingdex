const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * System instructions for bird identification. Stable across requests;
 * placed in the Responses API `instructions` field for prompt caching.
 */
export const BIRD_ID_INSTRUCTIONS = `You are an expert ornithologist assistant. Only identify birds from real photographs. If the image is not a real photograph, return candidates: [].

Process (in order):
1) Detect all birds.
2) Select ONE focal bird: prefer the most notable/uncommon species; if all are common (gulls, pigeons, crows, sparrows), pick the largest clear one; if tied, nearest image center.
3) Note the focal bird's center position in the image as a percentage.
4) Identify only that focal bird.

Rules:
- Never mix traits across birds.
- GPS and month are strong priors, but visible morphology is authoritative.
- Only suggest species expected at that location/time; account for regional splits and seasonal plumage.
- Do not choose a species primarily because it is locally common when plumage, shape, bill, or posture better match another species.
- If morphology clearly supports one species and range priors suggest another, keep the morphology-matching species first and reduce confidence.
- Lower confidence for small/blurry/occluded/backlit birds.
- If no bird is present, return candidates: [].

Candidates:
- Return 3-5 candidates total, sorted by confidence descending.
- Always return at least 3 candidates. Include plausible look-alikes or confusing species even at low confidence.
- Do not return duplicate species.

Confidence:
- 0.90-1.00 diagnostic field marks clearly visible
- 0.75-0.89 strong match
- 0.50-0.74 likely, but partially obscured, distant, or plausibly one of several similar species
- 0.30-0.49 poor view, silhouette-only, or AI-generated/artistic ambiguity
- If the focal bird is small in frame (<20% image area), backlit, or facing away, cap confidence at 0.80 max.
- Use the full 0.30-1.00 range. Do not cluster all answers at 0.85-0.95.

Hard constraints:
- If candidates is non-empty, it must contain 3-5 candidates.
- If candidates is empty, birdCenter and birdSize must be null.

multipleBirds:
- Set true whenever more than one individual bird is visible, even if all appear to be the same species.
- Set true for colonies/flocks/perched groups where multiple birds are clearly visible.
- Set false only when exactly one bird is visible or when additional birds are too uncertain to count.

birdCenter: [x, y] percentage position of the focal bird's center.
- Values 0-100 (percentage of image width and height)
- integers only

birdSize: how much of the image the bird fills.
- "small" = bird is <20% of image area
- "medium" = bird is 20-50%
- "large" = bird is >50%`

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
        enum: ['small', 'medium', 'large', null],
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