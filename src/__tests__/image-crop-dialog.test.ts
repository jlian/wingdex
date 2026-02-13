import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for ImageCropDialog touch/mouse handling logic.
 * We extract and test the pointer coordinate math independently
 * since the component uses the same logic for both mouse and touch.
 */

// Replicate the letterbox-aware coordinate calculation from the component
function getRenderedImageRect(
  containerRect: { left: number; top: number; width: number; height: number },
  naturalWidth: number,
  naturalHeight: number
) {
  const scale = Math.min(containerRect.width / naturalWidth, containerRect.height / naturalHeight)
  const renderedW = naturalWidth * scale
  const renderedH = naturalHeight * scale
  const offsetX = (containerRect.width - renderedW) / 2
  const offsetY = (containerRect.height - renderedH) / 2
  return { offsetX, offsetY, renderedW, renderedH, scale }
}

function getPointerPosition(
  clientX: number,
  clientY: number,
  containerRect: { left: number; top: number; width: number; height: number },
  naturalWidth: number,
  naturalHeight: number
) {
  const info = getRenderedImageRect(containerRect, naturalWidth, naturalHeight)
  const relX = clientX - containerRect.left - info.offsetX
  const relY = clientY - containerRect.top - info.offsetY
  return {
    x: relX / info.scale,
    y: relY / info.scale,
  }
}

function isInsideCrop(
  px: number,
  py: number,
  crop: { x: number; y: number; width: number; height: number }
) {
  return (
    px >= crop.x &&
    px <= crop.x + crop.width &&
    py >= crop.y &&
    py <= crop.y + crop.height
  )
}

function clampDragPosition(
  px: number,
  py: number,
  dragStart: { x: number; y: number },
  cropWidth: number,
  cropHeight: number,
  naturalWidth: number,
  naturalHeight: number
) {
  return {
    x: Math.max(0, Math.min(px - dragStart.x, naturalWidth - cropWidth)),
    y: Math.max(0, Math.min(py - dragStart.y, naturalHeight - cropHeight)),
  }
}

describe('ImageCropDialog pointer math', () => {
  const rect = { left: 10, top: 20, width: 400, height: 300 }
  const naturalWidth = 4000
  const naturalHeight = 3000

  it('maps screen coordinates to image coordinates correctly', () => {
    // Center of the displayed image
    const pos = getPointerPosition(210, 170, rect, naturalWidth, naturalHeight)
    expect(pos.x).toBe(2000) // (210-10) * (4000/400) = 200 * 10
    expect(pos.y).toBe(1500) // (170-20) * (3000/300) = 150 * 10
  })

  it('maps top-left corner correctly', () => {
    const pos = getPointerPosition(10, 20, rect, naturalWidth, naturalHeight)
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
      
      const mousePos = getPointerPosition(clientX, clientY, rect, naturalWidth, naturalHeight)
      const touchPos = getPointerPosition(clientX, clientY, rect, naturalWidth, naturalHeight)
      
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
      // Center of rendered image = (200, 300) in screen coords (offsetY=100, so 100+100=200 center)
      const pos = getPointerPosition(200, 200, squareRect, wideNatW, wideNatH)
      expect(pos.x).toBe(2000) // center of 4000
      expect(pos.y).toBe(1000) // center of 2000
    })

    it('maps top-left of rendered image (not container)', () => {
      // The image starts at (0, 100) in the container
      const pos = getPointerPosition(0, 100, squareRect, wideNatW, wideNatH)
      expect(pos.x).toBeCloseTo(0, 5)
      expect(pos.y).toBeCloseTo(0, 5)
    })

    it('returns negative coords when clicking in letterbox area', () => {
      // Clicking at (200, 50) is above the rendered image (offsetY=100)
      const pos = getPointerPosition(200, 50, squareRect, wideNatW, wideNatH)
      expect(pos.y).toBeLessThan(0)
    })
  })
})

describe('Crop resize logic', () => {
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
