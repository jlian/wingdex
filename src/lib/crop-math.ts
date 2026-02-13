/**
 * Pure math utilities for image crop coordinate mapping.
 * These compute pointer positions, hit testing, and drag clamping
 * for an image displayed with object-contain (letterboxing) inside a container.
 *
 * Extracted from ImageCropDialog so they can be tested without DOM dependencies.
 */

export interface ContainerRect {
  left: number
  top: number
  width: number
  height: number
}

export interface RenderedImageInfo {
  offsetX: number
  offsetY: number
  renderedW: number
  renderedH: number
  scale: number
}

export interface CropBox {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Compute where an image renders inside a container using object-contain logic.
 * Returns the offset (letterbox bars), rendered dimensions, and scale factor.
 */
export function computeRenderedImageRect(
  containerWidth: number,
  containerHeight: number,
  naturalWidth: number,
  naturalHeight: number
): RenderedImageInfo {
  const scale = Math.min(containerWidth / naturalWidth, containerHeight / naturalHeight)
  const renderedW = naturalWidth * scale
  const renderedH = naturalHeight * scale
  const offsetX = (containerWidth - renderedW) / 2
  const offsetY = (containerHeight - renderedH) / 2
  return { offsetX, offsetY, renderedW, renderedH, scale }
}

/**
 * Convert screen (client) coordinates to image-space coordinates,
 * accounting for object-contain letterboxing.
 */
export function computePointerPosition(
  clientX: number,
  clientY: number,
  containerRect: ContainerRect,
  naturalWidth: number,
  naturalHeight: number
): { x: number; y: number } {
  const info = computeRenderedImageRect(
    containerRect.width, containerRect.height, naturalWidth, naturalHeight
  )
  const relX = clientX - containerRect.left - info.offsetX
  const relY = clientY - containerRect.top - info.offsetY
  return {
    x: relX / info.scale,
    y: relY / info.scale,
  }
}

/** Check whether a point in image-space is inside a crop rectangle. */
export function isInsideCrop(
  px: number,
  py: number,
  crop: CropBox
): boolean {
  return (
    px >= crop.x &&
    px <= crop.x + crop.width &&
    py >= crop.y &&
    py <= crop.y + crop.height
  )
}

/** Clamp a drag position so the crop stays within image bounds. */
export function clampDragPosition(
  px: number,
  py: number,
  dragStart: { x: number; y: number },
  cropWidth: number,
  cropHeight: number,
  naturalWidth: number,
  naturalHeight: number
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(px - dragStart.x, naturalWidth - cropWidth)),
    y: Math.max(0, Math.min(py - dragStart.y, naturalHeight - cropHeight)),
  }
}
