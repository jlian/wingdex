const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function buildBirdIdPrompt(location, month, locationName) {
  const context = []

  if (location) {
    context.push(`Primary geolocation (authoritative): GPS ${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}.`)
  }
  if (locationName) {
    context.push(`Place label (secondary, may be noisy): ${locationName}.`)
  }
  if (month !== undefined) {
    context.push(`Month: ${MONTHS[month]}.`)
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