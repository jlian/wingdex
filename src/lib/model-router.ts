/**
 * Adaptive model router for bird identification.
 *
 * ONE shared pipeline, swappable front-end model:
 *   - On-device BioCLIP-2 when the model is cached/ready (instant, private,
 *     offline inference; range refinement still via the shared /api/range-adjust).
 *   - Server GPT otherwise (the existing /api/identify-bird path).
 *
 * Both produce the same BirdIdResult and both use the same server-side range +
 * gate pipeline, so results converge and there is no divergent per-platform
 * codepath. The router only decides WHICH model produces the candidate list.
 *
 * The routing is fully automatic and invisible to the user (no setting):
 *   - The model is prefetched silently in the background, but ONLY on a
 *     network that looks safe to pull ~300 MB over (Wi-Fi / fast, not
 *     Save-Data / cellular). This avoids a rude download on metered data.
 *   - Identify uses on-device when the model is ready or already cached;
 *     otherwise it uses GPT and (if the network is suitable) starts the
 *     background prefetch so later identifications are on-device.
 *   - Any on-device failure falls back to GPT transparently.
 *
 * Net effect: on Wi-Fi the model warms itself and identification silently
 * becomes on-device; on cellular it stays on GPT unless the model was already
 * cached from a previous good-network session.
 */

import { identifyBirdInPhoto, type BirdIdResult, type BirdIdModelTier } from './ai-inference'

// Lazily imported so onnxruntime-web + the model never touch the main bundle
// unless/until the feature actually runs.
type BioclipModule = typeof import('./bioclip-inference')
let bioclip: BioclipModule | null = null
async function getBioclip(): Promise<BioclipModule> {
  if (!bioclip) bioclip = await import('./bioclip-inference')
  return bioclip
}

type NetworkInformation = {
  effectiveType?: string
  downlink?: number
  saveData?: boolean
  type?: string
}
function getConnection(): NetworkInformation | undefined {
  if (typeof navigator === 'undefined') return undefined
  return (navigator as Navigator & { connection?: NetworkInformation }).connection
}

/**
 * Whether it's safe to auto-download ~300 MB right now.
 *
 * `navigator.connection` is only available on Chromium (Android/desktop). When
 * it's absent (Safari/Firefox) we conservatively allow prefetch only if the
 * model is already partially cached-friendly; here we default to allowing it,
 * since the alternative (never prefetching on Safari) would mean on-device
 * never warms there. Callers can still gate on isModelCached() for identify.
 */
export function isNetworkSuitableForPrefetch(): boolean {
  const c = getConnection()
  if (!c) return true // unknown (Safari/FF): allow; download is cached + one-time
  if (c.saveData) return false // user asked to save data
  if (c.type === 'cellular') return false
  // effectiveType: 'slow-2g' | '2g' | '3g' | '4g'
  if (c.effectiveType && ['slow-2g', '2g', '3g'].includes(c.effectiveType)) return false
  if (typeof c.downlink === 'number' && c.downlink > 0 && c.downlink < 2) return false // < 2 Mbps
  return true
}

let prefetchStarted = false

/**
 * Silently warm the on-device model in the background if the network looks
 * suitable. Idempotent and non-fatal: any failure just means we keep using GPT.
 */
export async function maybePrefetchModel(): Promise<void> {
  if (prefetchStarted) return
  try {
    const mod = await getBioclip()
    // Always allowed if already cached (no real download); otherwise gate on network.
    const cached = await mod.isModelCached()
    if (!cached && !isNetworkSuitableForPrefetch()) return
    prefetchStarted = true
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
 * Identify a bird, automatically choosing on-device BioCLIP when available,
 * otherwise GPT. `onRoute` reports which model actually ran (for debug/preview
 * surfaces). Signature mirrors identifyBirdInPhoto for a drop-in swap.
 */
export async function identifyBirdAdaptive(
  imageDataUrl: string,
  location?: { lat: number; lon: number },
  month?: number,
  locationName?: string,
  model: BirdIdModelTier = 'fast',
  onRoute?: (info: RouteInfo) => void,
): Promise<BirdIdResult> {
  try {
    const mod = await getBioclip()
    if (mod.isModelReady() || (await mod.isModelCached())) {
      await mod.loadModel()
      const img = await loadImage(imageDataUrl)
      const t0 = performance.now()
      const result = await mod.identifyOnDevice(img, location, month)
      onRoute?.({ source: 'on-device', inferenceMs: performance.now() - t0 })
      return result
    }
    // Not ready: warm it for next time (network-gated), fall through to GPT now.
    void maybePrefetchModel()
  } catch {
    // Any on-device failure -> graceful fallback to GPT.
  }

  onRoute?.({ source: 'server' })
  return identifyBirdInPhoto(imageDataUrl, location, month, locationName, model)
}
