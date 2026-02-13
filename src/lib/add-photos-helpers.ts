import type { ObservationStatus } from '@/lib/types'

// ─── Types ──────────────────────────────────────────────────

export type FlowStep =
  | 'upload'
  | 'extracting'
  | 'review'
  | 'photo-manual-crop'
  | 'photo-processing'
  | 'photo-confirm'
  | 'complete'

export interface PhotoResult {
  photoId: string
  species: string
  confidence: number
  status: ObservationStatus
  count: number
}

// ─── Pure helpers ───────────────────────────────────────────

/**
 * Whether the wizard is in a state where closing would lose progress.
 */
export function needsCloseConfirmation(step: FlowStep): boolean {
  return step !== 'upload' && step !== 'complete'
}

/**
 * Guard against advanceToNextPhoto being called with a MouseEvent
 * (from an onClick handler) instead of a results array.
 */
export function resolvePhotoResults(
  results: unknown,
  fallback: PhotoResult[],
): PhotoResult[] {
  return Array.isArray(results) ? results : fallback
}

/**
 * Filter results down to confirmed / possible observations.
 */
export function filterConfirmedResults(
  allResults: PhotoResult[],
): PhotoResult[] {
  return allResults.filter(
    r => r.status === 'confirmed' || r.status === 'possible',
  )
}

/**
 * Extract a user-friendly error message, with special handling
 * for rate-limit (429) errors from the AI service.
 */
export function friendlyErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Species identification failed'
  }
  const msg = error.message
  if (msg.includes('429') || msg.includes('rate')) {
    return 'AI rate limit reached. Please wait a minute before trying again.'
  }
  return msg
}
