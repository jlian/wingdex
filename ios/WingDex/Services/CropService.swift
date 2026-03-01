import Foundation

/// Crop box math utilities, ported from the web app's crop-math.ts.
///
/// All crop box coordinates are in percentages (0-100) of the natural image dimensions
/// unless otherwise noted.
enum CropService {
    struct CropBox {
        var x: Double
        var y: Double
        var width: Double
        var height: Double
    }

    struct RenderedImageInfo {
        let offsetX: Double
        let offsetY: Double
        let renderedW: Double
        let renderedH: Double
        let scale: Double
    }

    /// Compute a padded square crop from a percentage-based crop box.
    ///
    /// Matches `computePaddedSquareCropFromPercent` in crop-math.ts.
    /// - Parameters:
    ///   - percentCrop: Crop box in percentages (0-100)
    ///   - naturalWidth: Natural image width in pixels
    ///   - naturalHeight: Natural image height in pixels
    ///   - padRatio: Padding ratio (default 0.65)
    /// - Returns: Crop box in pixel coordinates
    static func paddedSquareCrop(
        from percentCrop: CropBox,
        naturalWidth: Double,
        naturalHeight: Double,
        padRatio: Double = 0.65
    ) -> CropBox {
        let px = percentCrop.x / 100.0 * naturalWidth
        let py = percentCrop.y / 100.0 * naturalHeight
        let pw = percentCrop.width / 100.0 * naturalWidth
        let ph = percentCrop.height / 100.0 * naturalHeight

        let centerX = px + pw / 2
        let centerY = py + ph / 2
        let side = max(pw, ph)
        let padded = side * (1 + padRatio)
        let finalSide = min(padded, min(naturalWidth, naturalHeight))

        let x = max(0, min(centerX - finalSide / 2, naturalWidth - finalSide))
        let y = max(0, min(centerY - finalSide / 2, naturalHeight - finalSide))

        return CropBox(x: x, y: y, width: finalSide, height: finalSide)
    }

    /// Compute the rendered image rectangle within a container (aspect-fit).
    ///
    /// Matches `computeRenderedImageRect` in crop-math.ts.
    static func renderedImageRect(
        containerW: Double,
        containerH: Double,
        naturalW: Double,
        naturalH: Double
    ) -> RenderedImageInfo {
        let scale = min(containerW / naturalW, containerH / naturalH)
        let renderedW = naturalW * scale
        let renderedH = naturalH * scale
        let offsetX = (containerW - renderedW) / 2
        let offsetY = (containerH - renderedH) / 2
        return RenderedImageInfo(
            offsetX: offsetX,
            offsetY: offsetY,
            renderedW: renderedW,
            renderedH: renderedH,
            scale: scale
        )
    }

    /// Convert a pointer position to natural image coordinates.
    static func pointerPosition(
        clientX: Double,
        clientY: Double,
        containerLeft: Double,
        containerTop: Double,
        containerW: Double,
        containerH: Double,
        naturalW: Double,
        naturalH: Double
    ) -> (x: Double, y: Double) {
        let info = renderedImageRect(
            containerW: containerW,
            containerH: containerH,
            naturalW: naturalW,
            naturalH: naturalH
        )
        let x = (clientX - containerLeft - info.offsetX) / info.scale
        let y = (clientY - containerTop - info.offsetY) / info.scale
        return (x, y)
    }

    /// Check if a point is inside a crop box (both in pixel coordinates).
    static func isInsideCrop(px: Double, py: Double, crop: CropBox) -> Bool {
        px >= crop.x && px <= crop.x + crop.width &&
            py >= crop.y && py <= crop.y + crop.height
    }

    /// Clamp a drag position so the crop box stays within image bounds.
    static func clampDragPosition(
        px: Double,
        py: Double,
        cropW: Double,
        cropH: Double,
        naturalW: Double,
        naturalH: Double
    ) -> (x: Double, y: Double) {
        let x = max(0, min(px, naturalW - cropW))
        let y = max(0, min(py, naturalH - cropH))
        return (x, y)
    }
}
