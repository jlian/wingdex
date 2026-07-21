/**
 * Adaptive model router for bird identification.
 *
 * ONE shared pipeline, swappable front-end model:
 *   - On-device BioCLIP-2 when the model is cached/ready (instant, free, offline
 *     inference; range refinement still via the shared /api/range-adjust).
 *   - Server GPT otherwise (the existing /api/identify-bird path).
 *
 * Both produce the same BirdIdResult, and both use the same server-side range +
 * gate pipeline, so results converge and there is no divergent per-platform
 * codepath. The router only decides WHICH model produces the candidate list.
 *
 * Routing policy (this PR keeps it conservative and off-by-default):
 *   - Feature flag off  -> always GPT (unchanged behavior).
 *   - Flag on + model ready/cached -> on-device.
 *   - Flag on + not cached -> GPT now, and kick off a background prefetch so the
 *     model is ready next time. (No auto-download of 307 MB mid-identify.)
 */

import { identifyBirdInPhoto, type BirdIdResult, type BirdIdModelTier } from './ai-inference'
import { isOnDeviceEnabled } from './storage-keys'

// Lazily imported so onnxruntime-web + the model never touch the main bundle
// unless the feature is actually used.
type BioclipModule = typeof import('./bioclip-inference')
let bioclip: BioclipModule | null = null
async function getBioclip(): Promise<BioclipModule> {
  if (!bioclip) bioclip = await import('./bioclip-inference')
  return bioclip
}

let prefetchStarted = false

/** Kick off a background model prefetch once (no-op if already started/cached). */
export async function maybePrefetchModel(): Promise<void> {
  if (prefetchStarted || !isOnDeviceEnabled()) return
  prefetchStarted = true
  try {
    const mod = await getBioclip()
    // Fire and forget; errors are non-fatal (we fall back to GPT).
    void mod.loadModel().catch(() => { prefetchStarted = false })
  } catch {
    prefetchStarted = false
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

export interface RouteInfo {
  source: 'on-device' | 'server'
  inferenceMs?: number
}

/**
 * Identify a bird, choosing on-device BioCLIP when available, otherwise GPT.
 * `onRoute` reports which model actually ran (useful for the preview/debug UI).
 * Signature intentionally mirrors identifyBirdInPhoto for a drop-in swap.
 */
export async function identifyBirdAdaptive(
  imageDataUrl: string,
  location?: { lat: number; lon: number },
  month?: number,
  locationName?: string,
  model: BirdIdModelTier = 'fast',
  onRoute?: (info: RouteInfo) => void,
): Promise<BirdIdResult> {
  if (isOnDeviceEnabled()) {
    try {
      const mod = await getBioclip()
      if (mod.isModelReady() || (await mod.isModelCached())) {
        await mod.loadModel()
        const img = await loadImage(imageDataUrl)
        const result = await mod.identifyOnDevice(img, location, month)
        onRoute?.({ source: 'on-device' })
        return result
      }
      // Not ready: start prefetch for next time, fall through to GPT now.
      void maybePrefetchModel()
    } catch {
      // Any on-device failure -> graceful fallback to GPT.
    }
  }

  onRoute?.({ source: 'server' })
  return identifyBirdInPhoto(imageDataUrl, location, month, locationName, model)
}
