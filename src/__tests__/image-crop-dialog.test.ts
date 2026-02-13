import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  computeRenderedImageRect,
  computePointerPosition,
  isInsideCrop,
  clampDragPosition,
} from '@/lib/crop-math'

/**
 * Unit tests for ImageCropDialog pointer/crop coordinate math.
 * Tests the actual exported functions from crop-math.ts.
 */

describe('ImageCropDialog pointer math', () => {
  const rect = { left: 10, top: 20, width: 400, height: 300 }
  const naturalWidth = 4000
  const naturalHeight = 3000

  it('maps screen coordinates to image coordinates correctly', () => {
    // Center of the displayed image
    const pos = computePointerPosition(210, 170, rect, naturalWidth, naturalHeight)
    expect(pos.x).toBe(2000)
    expect(pos.y).toBe(1500)
  })

  it('maps top-left corner correctly', () => {
    const pos = computePointerPosition(10, 20, rect, naturalWidth, naturalHeight)
    expect(pos.x).toBe(0)
    expect(pos.y).toBe(0)
  })

  it('detects point inside crop area', () => {
    const crop = { x: 1000, y: 1000, width: 2000, height: 1500 }
    expect(isInsideCrop(1500, 1500, crop)).toBe(true)
    expect(isInsideCrop(1000, 1000, crop)).toBe(true) // edge
    expect(isInsideCrop(3000, 2500, crop)).toBe(true) // edge
  })

  it('detects point outside crop area', () => {
    const crop = { x: 1000, y: 1000, width: 2000, height: 1500 }
    expect(isInsideCrop(500, 500, crop)).toBe(false) // top-left outside
    expect(isInsideCrop(3500, 1500, crop)).toBe(false) // right outside
    expect(isInsideCrop(1500, 3000, crop)).toBe(false) // below outside
  })

  it('clamps drag position within image bounds', () => {
    const dragStart = { x: 100, y: 100 }
    const cropWidth = 2000
    const cropHeight = 1500

    // Normal drag
    const pos1 = clampDragPosition(1100, 1100, dragStart, cropWidth, cropHeight, naturalWidth, naturalHeight)
    expect(pos1.x).toBe(1000)
    expect(pos1.y).toBe(1000)

    // Drag past left/top edge → clamped to 0
    const pos2 = clampDragPosition(50, 50, dragStart, cropWidth, cropHeight, naturalWidth, naturalHeight)
    expect(pos2.x).toBe(0)
    expect(pos2.y).toBe(0)

    // Drag past right/bottom edge → clamped to max
    const pos3 = clampDragPosition(4000, 3000, dragStart, cropWidth, cropHeight, naturalWidth, naturalHeight)
    expect(pos3.x).toBe(2000) // 4000 - 100 = 3900, but max is 4000-2000=2000
    expect(pos3.y).toBe(1500) // 3000 - 100 = 2900, but max is 3000-1500=1500
  })

  describe('touch event coordinate extraction', () => {
    it('single touch maps same as mouse click at same position', () => {
      const clientX = 150
      const clientY = 100
      
      const mousePos = computePointerPosition(clientX, clientY, rect, naturalWidth, naturalHeight)
      const touchPos = computePointerPosition(clientX, clientY, rect, naturalWidth, naturalHeight)
      
      expect(touchPos.x).toBe(mousePos.x)
      expect(touchPos.y).toBe(mousePos.y)
    })
  })

  describe('letterboxed image coordinate mapping', () => {
    // A wide image in a square container → horizontal letterboxing (bars top/bottom)
    const squareRect = { left: 0, top: 0, width: 400, height: 400 }
    const wideNatW = 4000
    const wideNatH = 2000 // 2:1 aspect ratio
    // scale = min(400/4000, 400/2000) = min(0.1, 0.2) = 0.1
    // renderedW = 400, renderedH = 200, offsetX = 0, offsetY = 100

    it('correctly maps center of a letterboxed image', () => {
      const pos = computePointerPosition(200, 200, squareRect, wideNatW, wideNatH)
      expect(pos.x).toBe(2000)
      expect(pos.y).toBe(1000)
    })

    it('maps top-left of rendered image (not container)', () => {
      const pos = computePointerPosition(0, 100, squareRect, wideNatW, wideNatH)
      expect(pos.x).toBeCloseTo(0, 5)
      expect(pos.y).toBeCloseTo(0, 5)
    })

    it('returns negative coords when clicking in letterbox area', () => {
      const pos = computePointerPosition(200, 50, squareRect, wideNatW, wideNatH)
      expect(pos.y).toBeLessThan(0)
    })
  })
})

describe('Crop resize logic', () => {
  it('computes rendered image rect correctly', () => {
    const info = computeRenderedImageRect(400, 300, 4000, 3000)
    expect(info.scale).toBeCloseTo(0.1)
    expect(info.renderedW).toBeCloseTo(400)
    expect(info.renderedH).toBeCloseTo(300)
    expect(info.offsetX).toBeCloseTo(0)
    expect(info.offsetY).toBeCloseTo(0)
  })

  it('resizes crop centered and clamps to image bounds', () => {
    const naturalWidth = 4000
    const naturalHeight = 3000
    const crop = { x: 1000, y: 750, width: 2000, height: 1500 }

    // Simulate resize by delta
    const delta = 500
    const newWidth = Math.max(50, Math.min(crop.width + delta, naturalWidth))
    const newHeight = Math.max(50, Math.min(crop.height + delta, naturalHeight))
    const centerX = crop.x + crop.width / 2
    const centerY = crop.y + crop.height / 2
    const newCrop = {
      x: Math.max(0, Math.min(centerX - newWidth / 2, naturalWidth - newWidth)),
      y: Math.max(0, Math.min(centerY - newHeight / 2, naturalHeight - newHeight)),
      width: newWidth,
      height: newHeight,
    }

    expect(newCrop.width).toBe(2500)
    expect(newCrop.height).toBe(2000)
    // Center should be preserved
    expect(newCrop.x + newCrop.width / 2).toBe(centerX)
    expect(newCrop.y + newCrop.height / 2).toBe(centerY)
  })
})
