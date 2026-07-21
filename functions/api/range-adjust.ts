import { findBestMatch, getWikiTitle } from '../lib/taxonomy'
import { getRangePriors, adjustConfidence } from '../lib/range-filter'
import { HttpError } from '../lib/http-error'
import { createRouteResponder } from '../lib/log'

/**
 * POST /api/range-adjust
 *
 * Applies the shared post-processing pipeline (taxonomy grounding + range-prior
 * tiering + confidence gate) to a candidate list produced by an ON-DEVICE model
 * (BioCLIP-2). This keeps range logic server-side as the single source of truth,
 * identical to the server GPT path, while the expensive/private vision inference
 * runs in the browser.
 *
 * The one difference vs the GPT pipeline: on-device candidates are softmax
 * probabilities over ~11k species, where the true bird's absolute score can be
 * low and several out-of-range congeners can outrank it. So instead of GPT's
 * "slice-5-then-multiply", we:
 *   - keep the top-K candidates (not a fixed 0.2 floor),
 *   - GATE on dominance: if the top candidate dominates (margin >= DOM_MARGIN),
 *     trust the visual ID and keep raw order (morphology authoritative);
 *   - otherwise TIER by range status (present > near-range > out-of-range),
 *     keeping model order within each tier.
 * This mirrors the winning strategy from the on-device spike (87/96 vs GPT 83/87).
 *
 * Request body:
 *   {
 *     candidates: [{ commonName, scientificName?, confidence }],  // model output
 *     lat?, lon?, month?                                          // optional context
 *   }
 * Response: same shape as /api/identify-bird's result (candidates + rangeAdjusted).
 */

const DOM_MARGIN = 0.5   // top-1 vs top-2 gap above which we trust the visual ID
const TOP_K = 15         // candidates to keep before ranking
const RESULT_N = 5       // candidates returned
const TIER: Record<string, number> = { 'present': 0, 'near-range': 1, 'no-data': 2, 'out-of-range': 3 }

type RawCandidate = { commonName?: unknown; scientificName?: unknown; confidence?: unknown; plumage?: unknown }

type GroundedCandidate = {
  species: string
  commonName: string
  scientificName: string
  confidence: number
  ebirdCode: string
  wikiTitle?: string
  plumage?: string
}

function parseBody(body: unknown): { candidates: RawCandidate[]; lat?: number; lon?: number; month?: number } {
  if (typeof body !== 'object' || body === null) throw new HttpError(400, 'Invalid JSON body')
  const b = body as Record<string, unknown>
  if (!Array.isArray(b.candidates)) throw new HttpError(400, 'candidates must be an array')
  if (b.candidates.length > 50) throw new HttpError(400, 'too many candidates (max 50)')
  const num = (v: unknown) => (v == null ? undefined : Number.isFinite(Number(v)) ? Number(v) : undefined)
  const month = num(b.month)
  if (month !== undefined && (!Number.isInteger(month) || month < 0 || month > 11)) {
    throw new HttpError(400, 'month must be an integer 0-11')
  }
  return { candidates: b.candidates as RawCandidate[], lat: num(b.lat), lon: num(b.lon), month }
}

/** Ground raw model candidates to the taxonomy, keeping all valid matches. */
function groundCandidates(raw: RawCandidate[]): GroundedCandidate[] {
  const seen = new Set<string>()
  const out: GroundedCandidate[] = []
  for (const c of raw) {
    const common = String(c?.commonName ?? '')
    const sci = String(c?.scientificName ?? '')
    const confidence = Number(c?.confidence)
    if (!(common || sci) || !Number.isFinite(confidence)) continue
    const lookup = sci ? `${common} (${sci})` : common
    const match = findBestMatch(lookup)
    if (!match) continue
    const species = `${match.common} (${match.scientific})`
    if (seen.has(species)) continue
    seen.add(species)
    out.push({
      species,
      commonName: match.common,
      scientificName: match.scientific,
      confidence,
      ebirdCode: match.ebirdCode || '',
      wikiTitle: getWikiTitle(match.common),
      plumage: typeof c?.plumage === 'string' && c.plumage ? c.plumage : undefined,
    })
  }
  return out.sort((a, b) => b.confidence - a.confidence)
}

export const onRequestPost: PagesFunction<Env> = async context => {
  const log = (context.data as RequestData).log
  const route = createRouteResponder(log, 'birdId/rangeAdjust/invoke', 'Application')
  try {
    const user = (context.data as { user?: { id?: string; isAnonymous?: boolean } }).user
    if (!user?.id) return route.fail(401, 'Unauthorized', 'No authenticated user for range-adjust')
    if (user.isAnonymous) return route.fail(403, 'Account required', 'Anonymous users cannot use range-adjust')

    let body: unknown
    try {
      body = await context.request.json()
    } catch {
      throw new HttpError(400, 'Invalid JSON body')
    }
    const { candidates: rawCandidates, lat, lon, month } = parseBody(body)

    let candidates = groundCandidates(rawCandidates).slice(0, TOP_K)

    let rangeAdjusted = false
    const hasLocation = lat !== undefined && lon !== undefined

    if (hasLocation && candidates.length > 0 && context.env.RANGE_PRIORS) {
      // Dominance gate: if the model is confident, trust the visual ID.
      const dominant = candidates.length >= 1 &&
        (candidates[0].confidence - (candidates[1]?.confidence ?? 0)) >= DOM_MARGIN

      if (!dominant) {
        const codes = candidates.map(c => c.ebirdCode).filter(Boolean)
        const priors = await getRangePriors(context.env.RANGE_PRIORS, lat!, lon!, month, codes)
        rangeAdjusted = [...priors.values()].some(r => r.status !== 'no-data')

        const withTier = candidates.map(c => {
          const range = priors.get(c.ebirdCode) || { status: 'no-data' as const }
          // Within-tier ordering still respects presence/origin/seasonal nudges,
          // but out-of-range is handled by the hard tier, not a multiplier.
          const inTierStatus = range.status === 'out-of-range' ? { ...range, status: 'present' as const } : range
          const adj = adjustConfidence(c.confidence, inTierStatus, month, lat)
          return { c: { ...c, rangeStatus: range.status }, tier: TIER[range.status] ?? 2, adj }
        })
        withTier.sort((a, b) => a.tier - b.tier || b.adj - a.adj)
        candidates = withTier.map(x => x.c)
      }
    }

    const result = {
      candidates: candidates.slice(0, RESULT_N).map(({ ebirdCode: _e, plumage, ...rest }) => ({
        ...rest,
        ...(plumage ? { plumage } : {}),
      })),
      ...(rangeAdjusted ? { rangeAdjusted: true } : {}),
    }
    route.debug(`Range-adjusted ${result.candidates.length} on-device candidates${rangeAdjusted ? ' (range-adjusted)' : ''}`, { candidateCount: result.candidates.length, rangeAdjusted })
    return Response.json(result)
  } catch (error) {
    if (error instanceof HttpError) {
      return route.fail(error.status, error.message, `range-adjust failed: ${error.message}`)
    }
    const message = error instanceof Error ? error.message : String(error)
    return route.fail(500, 'An unexpected error occurred during range adjustment', `range-adjust failed unexpectedly: ${message}`, { error: message })
  }
}
