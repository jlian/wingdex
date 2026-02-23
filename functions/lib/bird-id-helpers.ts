/**
 * Pure helper functions extracted from bird-id.ts so they can be tested
 * without pulling in Cloudflare Worker types (Env).
 */

type CropBox = { x: number; y: number; width: number; height: number }

export function safeParseJSON(text: string): any {
  try {
    return JSON.parse(text)
  } catch {}

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim())
    } catch {}
  }

  const objectLike = text.match(/\{[\s\S]*\}/)
  if (objectLike?.[0]) {
    try {
      return JSON.parse(objectLike[0])
    } catch {}
  }

  return null
}

export function extractAssistantContent(payload: any): string {
  const message = payload?.choices?.[0]?.message
  const content = message?.content

  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    const joined = content
      .map((part: any) => {
        if (typeof part === 'string') return part
        if (typeof part?.text === 'string') return part.text
        if (typeof part?.text?.value === 'string') return part.text.value
        if (part?.type === 'output_text' && typeof part?.content === 'string') return part.content
        if (typeof part?.content === 'string') return part.content
        return ''
      })
      .filter(Boolean)
      .join('\n')

    if (joined) return joined
  }

  if (typeof message?.refusal === 'string' && message.refusal) {
    return message.refusal
  }

  if (content && typeof content === 'object') {
    try {
      return JSON.stringify(content)
    } catch {}
  }

  return ''
}

export function buildCropBox(
  birdCenter: unknown,
  birdSize: unknown,
  imageWidth?: number,
  imageHeight?: number,
): CropBox | undefined {
  if (!Array.isArray(birdCenter) || birdCenter.length < 2) return undefined

  const cx = Number(birdCenter[0])
  const cy = Number(birdCenter[1])
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return undefined

  const clampedCx = Math.max(0, Math.min(100, cx))
  const clampedCy = Math.max(0, Math.min(100, cy))

  const sizePct = birdSize === 'large' ? 0.75 : birdSize === 'medium' ? 0.55 : 0.4

  if (imageWidth && imageHeight && imageWidth > 0 && imageHeight > 0) {
    const shortSide = Math.min(imageWidth, imageHeight)
    const cropPx = shortSide * sizePct
    const wPct = (cropPx / imageWidth) * 100
    const hPct = (cropPx / imageHeight) * 100
    const x = Math.max(0, Math.min(100 - wPct, clampedCx - wPct / 2))
    const y = Math.max(0, Math.min(100 - hPct, clampedCy - hPct / 2))
    return {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(wPct),
      height: Math.round(hPct),
    }
  }

  const pct = Math.round(sizePct * 100)
  const x = Math.max(0, Math.min(100 - pct, clampedCx - pct / 2))
  const y = Math.max(0, Math.min(100 - pct, clampedCy - pct / 2))

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: pct,
    height: pct,
  }
}
