import { createRouteResponder } from '../lib/log'

/**
 * GET /models/* — serve on-device model assets from the R2 `MODELS` bucket.
 *
 * The BioCLIP int8 model is ~307 MB, far above Cloudflare's 25 MiB static-asset
 * limit, so it can't ship in /dist. It lives in R2 and is streamed through the
 * Worker here with long-lived immutable caching and HTTP range support (so the
 * browser can resume/stream the download).
 *
 * Assets (uploaded via scripts/upload-model.mjs):
 *   /models/bioclip2_visual_int8.onnx
 *   /models/text_embeds_int8.bin
 *   /models/text_embeds_scale.bin
 *   /models/species.json
 */

const ALLOWED = new Set([
  'bioclip2_visual_int8.onnx',
  'text_embeds_int8.bin',
  'text_embeds_scale.bin',
  'species.json',
])

const CONTENT_TYPES: Record<string, string> = {
  '.onnx': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.json': 'application/json',
}

export const onRequestGet: PagesFunction<Env> = async context => {
  const log = (context.data as RequestData)?.log
  const route = createRouteResponder(log, 'models/serve/invoke', 'Application')

  if (!context.env.MODELS) {
    return route.fail(503, 'Model storage not configured', 'MODELS R2 bucket binding missing')
  }

  const parts = (context.params.path as string[]) || []
  const key = parts.join('/')
  if (!ALLOWED.has(key)) {
    return route.fail(404, 'Not found', `Model asset not allowed: ${key}`)
  }

  const ext = key.slice(key.lastIndexOf('.'))
  const contentType = CONTENT_TYPES[ext] || 'application/octet-stream'
  const rangeHeader = context.request.headers.get('range')
  const parsedRange = rangeHeader ? parseRange(rangeHeader) : undefined

  const object = parsedRange
    ? await context.env.MODELS.get(key, { range: parsedRange })
    : await context.env.MODELS.get(key)

  if (!object) {
    return route.fail(404, 'Not found', `Model asset missing in R2: ${key}`)
  }

  const headers = new Headers()
  headers.set('Content-Type', contentType)
  // Cache aggressively but revalidate: the filenames are stable/non-versioned,
  // so `immutable` would pin a stale model forever if an asset is ever replaced
  // in R2. A long max-age keeps it fast, while ETag + must-revalidate lets
  // clients pick up a new upload via a cheap 304 once the cached copy is stale.
  headers.set('Cache-Control', 'public, max-age=86400, must-revalidate')
  headers.set('ETag', object.httpEtag)
  headers.set('Accept-Ranges', 'bytes')
  const range = (object as R2ObjectBody & { range?: { offset: number; length: number } }).range
  if (parsedRange && object.size != null && range) {
    const start = range.offset ?? 0
    const end = Math.min(start + (range.length ?? object.size) - 1, object.size - 1)
    headers.set('Content-Range', `bytes ${start}-${end}/${object.size}`)
    headers.set('Content-Length', String(end - start + 1))
    return new Response(object.body, { status: 206, headers })
  }

  headers.set('Content-Length', String(object.size))
  return new Response(object.body, { status: 200, headers })
}

/**
 * Parse a single-range `bytes=start-[end]` header into an R2 range option.
 * Returns undefined for absent, malformed, or invalid (end < start) ranges so
 * callers omit the range option entirely and serve the full object.
 */
function parseRange(header: string): { offset: number; length: number } | { offset: number } | undefined {
  const m = /^bytes=(\d+)-(\d*)$/.exec(header.trim())
  if (!m) return undefined
  const start = Number(m[1])
  if (!Number.isFinite(start) || start < 0) return undefined
  if (m[2] === '') return { offset: start } // open-ended: start to EOF
  const end = Number(m[2])
  if (!Number.isFinite(end) || end < start) return undefined
  return { offset: start, length: end - start + 1 }
}
