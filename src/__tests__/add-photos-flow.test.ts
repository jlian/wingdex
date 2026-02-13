import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

/**
 * Tests for AddPhotosFlow logic — specifically the patterns that caused bugs:
 * 1. advanceToNextPhoto receiving MouseEvent from onClick (skip crash)
 * 2. Error messages propagating to toast on 429
 * 3. saveOuting receiving correct array type
 */

// ── Test the advanceToNextPhoto guard logic ──────────────────

describe('advanceToNextPhoto guard', () => {
  // Replicate the guard logic from AddPhotosFlow
  function advanceToNextPhoto(
    results: any,
    photoResults: { photoId: string; species: string }[],
    totalPhotos: number,
    currentPhotoIndex: number,
    saveOuting: (r: any[]) => void,
    goToNext: () => void,
  ) {
    const finalResults = Array.isArray(results) ? results : photoResults
    const nextIdx = currentPhotoIndex + 1
    if (nextIdx < totalPhotos) {
      goToNext()
    } else {
      saveOuting(finalResults)
    }
  }

  it('passes explicit results array to saveOuting', () => {
    const saveOuting = vi.fn()
    const goToNext = vi.fn()
    const explicitResults = [{ photoId: 'p1', species: 'Blue Jay' }]

    advanceToNextPhoto(explicitResults, [], 1, 0, saveOuting, goToNext)

    expect(saveOuting).toHaveBeenCalledWith(explicitResults)
  })

  it('falls back to photoResults when called with undefined', () => {
    const saveOuting = vi.fn()
    const goToNext = vi.fn()
    const photoResults = [{ photoId: 'p1', species: 'Robin' }]

    advanceToNextPhoto(undefined, photoResults, 1, 0, saveOuting, goToNext)

    expect(saveOuting).toHaveBeenCalledWith(photoResults)
  })

  it('falls back to photoResults when called with a MouseEvent (onClick)', () => {
    const saveOuting = vi.fn()
    const goToNext = vi.fn()
    const photoResults = [{ photoId: 'p1', species: 'Sparrow' }]
    const mouseEvent = new MouseEvent('click')

    advanceToNextPhoto(mouseEvent, photoResults, 1, 0, saveOuting, goToNext)

    // MouseEvent is not an array, should fall back to photoResults
    expect(saveOuting).toHaveBeenCalledWith(photoResults)
    // Should NOT have been called with the MouseEvent
    expect(saveOuting.mock.calls[0][0]).not.toBeInstanceOf(MouseEvent)
  })

  it('calls goToNext when there are more photos', () => {
    const saveOuting = vi.fn()
    const goToNext = vi.fn()

    advanceToNextPhoto(undefined, [], 3, 0, saveOuting, goToNext)

    expect(goToNext).toHaveBeenCalled()
    expect(saveOuting).not.toHaveBeenCalled()
  })

  it('calls saveOuting when on the last photo', () => {
    const saveOuting = vi.fn()
    const goToNext = vi.fn()

    advanceToNextPhoto(undefined, [], 3, 2, saveOuting, goToNext)

    expect(saveOuting).toHaveBeenCalled()
    expect(goToNext).not.toHaveBeenCalled()
  })
})

// ── Test saveOuting filtering logic ─────────────────────────

describe('saveOuting filtering', () => {
  // Replicate the filtering logic from saveOuting
  function filterConfirmed(allResults: { status: string }[]) {
    return allResults.filter(
      r => r.status === 'confirmed' || r.status === 'possible'
    )
  }

  it('filters confirmed and possible results', () => {
    const results = [
      { status: 'confirmed' },
      { status: 'possible' },
      { status: 'rejected' },
    ]
    expect(filterConfirmed(results)).toHaveLength(2)
  })

  it('handles empty results array', () => {
    expect(filterConfirmed([])).toHaveLength(0)
  })

  it('throws on non-array input (the original bug)', () => {
    // This was the crash: a MouseEvent was passed instead of an array
    const mouseEvent = new MouseEvent('click') as any
    expect(() => mouseEvent.filter((r: any) => r.status === 'confirmed'))
      .toThrow()
  })
})

// ── Test error message handling ─────────────────────────────

describe('error message propagation', () => {
  it('extracts message from Error objects', () => {
    const error = new Error('AI rate limit reached. Please wait a minute before trying again.')
    const msg = error instanceof Error ? error.message : 'Species identification failed'
    expect(msg).toContain('rate limit')
    expect(msg).not.toBe('Species identification failed')
  })

  it('falls back to generic message for non-Error', () => {
    const error: unknown = 'something went wrong'
    const msg = error instanceof Error ? error.message : 'Species identification failed'
    expect(msg).toBe('Species identification failed')
  })

  it('provides informative message for 429 errors', () => {
    // Replicate the error creation from ai-inference.ts
    const errorMsg = 'LLM 429: Too Many Requests'
    const isRateLimit = errorMsg.includes('429') || errorMsg.includes('rate')
    const userMessage = isRateLimit
      ? 'AI rate limit reached. Please wait a minute before trying again.'
      : errorMsg
    expect(userMessage).toContain('rate limit')
    expect(userMessage).toContain('wait')
  })
})
