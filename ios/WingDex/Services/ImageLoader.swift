import UIKit
import Vision
import os

private final class FocalPointResultBox {
    let point: CGPoint?

    init(_ point: CGPoint?) {
        self.point = point
    }
}

enum FocalCropGeometry {
    static let center = CGPoint(x: 0.5, y: 0.5)

    static func renderedFrame(
        imageSize: CGSize,
        containerSize: CGSize,
        focalPoint: CGPoint
    ) -> CGRect {
        guard imageSize.width > 0, imageSize.height > 0,
              containerSize.width > 0, containerSize.height > 0
        else { return .zero }

        let scale = max(
            containerSize.width / imageSize.width,
            containerSize.height / imageSize.height
        )
        let renderedSize = CGSize(
            width: imageSize.width * scale,
            height: imageSize.height * scale
        )
        let origin = CGPoint(
            x: min(
                max(
                    (containerSize.width / 2) - renderedSize.width * focalPoint.x,
                    containerSize.width - renderedSize.width
                ),
                0
            ),
            y: min(
                max(
                    (containerSize.height / 2) - renderedSize.height * focalPoint.y,
                    containerSize.height - renderedSize.height
                ),
                0
            )
        )
        return CGRect(origin: origin, size: renderedSize)
    }

    /// Normalized source rectangle with the container's aspect ratio, centered on and
    /// clamped around the focal point.
    static func sourceRect(
        imageSize: CGSize,
        containerSize: CGSize,
        focalPoint: CGPoint
    ) -> CGRect {
        guard imageSize.width > 0, imageSize.height > 0,
              containerSize.width > 0, containerSize.height > 0
        else { return CGRect(origin: .zero, size: CGSize(width: 1, height: 1)) }

        let imageAspect = imageSize.width / imageSize.height
        let containerAspect = containerSize.width / containerSize.height
        if imageAspect > containerAspect {
            let width = containerAspect / imageAspect
            let x = min(max(focalPoint.x - width / 2, 0), 1 - width)
            return CGRect(x: x, y: 0, width: width, height: 1)
        }

        let height = imageAspect / containerAspect
        let y = min(max(focalPoint.y - height / 2, 0), 1 - height)
        return CGRect(x: 0, y: y, width: 1, height: height)
    }
}

/// Shared image cache for remote bird photos.
///
/// Three properties matter here and none of them come for free:
///
/// - **Coalescing.** A dex row, a context-menu preview hero, and the pushed detail hero can
///   ask for the same URL at nearly the same moment. One download serves all of them.
/// - **Load lifetime outlives the caller.** Work runs in unstructured tasks, so cancelling
///   the awaiting view does not cancel the download. Dismissing a preview mid-flight keeps
///   the bytes, which is what makes long-press act as a prefetch for the detail view.
/// - **Downsampling.** Wikipedia originals run to several thousand pixels. Decoding one at
///   full size for a 280pt hero costs tens of MB of RAM.
@MainActor
final class ImageLoader {
    static let shared = ImageLoader()

    private let images = NSCache<NSString, UIImage>()
    private var focalPoints: [String: FocalPointResultBox] = [:]
    private var decodes: [String: Task<UIImage?, Never>] = [:]
    private var downloads: [String: Task<Data?, Never>] = [:]
    private var saliency: [String: Task<CGPoint?, Never>] = [:]

    init(totalCostLimit: Int = 64 * 1024 * 1024) {
        images.totalCostLimit = totalCostLimit
    }

    /// Synchronous cache probe, for seeding `@State` in an initializer so a warm image
    /// renders on frame one instead of after `.task` runs.
    func cached(_ url: String?, targetPoints: CGFloat) -> UIImage? {
        guard let url, !url.isEmpty else { return nil }
        return images.object(forKey: Self.cacheKey(url, targetPoints) as NSString)
    }

    func cachedImageAndFocalPoint(
        _ url: String?,
        targetPoints: CGFloat
    ) -> (image: UIImage, focalPoint: CGPoint)? {
        guard let url, !url.isEmpty else { return nil }
        let imageKey = Self.cacheKey(url, targetPoints)
        let focalKey = Self.focalCacheKey(url)
        guard let image = images.object(forKey: imageKey as NSString),
              let result = focalPoints[focalKey]
        else { return nil }
        return (image, result.point ?? Self.center)
    }

    func image(for url: String?, targetPoints: CGFloat) async -> UIImage? {
        guard let url, !url.isEmpty else { return nil }
        let key = Self.cacheKey(url, targetPoints)
        if let hit = images.object(forKey: key as NSString) {
            return hit
        }
        if let inFlight = decodes[key] { return await inFlight.value }

        let maxPixelSize = targetPoints * Self.displayScale
        let task = Task { [weak self] () -> UIImage? in
            guard let self, let data = await self.data(for: url) else { return nil }
            let decodeStarted = DispatchTime.now().uptimeNanoseconds
            guard let image = await Self.downsample(data, maxPixelSize: maxPixelSize) else { return nil }
            Self.logger.debug(
                "Image decode \(Self.logLabel(url), privacy: .public): \(Self.elapsedMilliseconds(since: decodeStarted)) ms, target \(Int(maxPixelSize)) px, result \(Int(image.size.width))x\(Int(image.size.height)) pt"
            )
            // Keep the proven image cache independent from optional Vision metadata.
            self.images.setObject(image, forKey: key as NSString, cost: image.decodedByteCost)
            // Register before returning so imageAndFocalPoint() consumes these bytes
            // instead of starting a second download after data(for:) releases its entry.
            self.startSaliency(
                data: data,
                key: Self.focalCacheKey(url),
                label: Self.logLabel(url)
            )
            return image
        }
        decodes[key] = task
        let image = await task.value
        decodes[key] = nil
        return image
    }

    func imageAndFocalPoint(
        for url: String?,
        targetPoints: CGFloat
    ) async -> (image: UIImage, focalPoint: CGPoint)? {
        guard let url, !url.isEmpty,
              let image = await image(for: url, targetPoints: targetPoints),
              let result = await focalPointResult(for: url)
        else { return nil }
        return (image, result.point ?? Self.center)
    }

    private func focalPointResult(for url: String?) async -> FocalPointResultBox? {
        guard let url, !url.isEmpty else { return nil }
        let key = Self.focalCacheKey(url)
        if let result = focalPoints[key] {
            return result
        }
        guard let inFlight = saliency[key] else { return nil }
        _ = await inFlight.value
        return focalPoints[key]
    }

    func logCrop(
        image: UIImage,
        focalPoint: CGPoint,
        containerSize: CGSize,
        url: String?
    ) {
        logCrop(
            image: image,
            focalPoint: focalPoint,
            containerSize: containerSize,
            label: Self.logLabel(url)
        )
    }

    func logCrop(
        image: UIImage,
        focalPoint: CGPoint,
        containerSize: CGSize,
        label: String
    ) {
        guard containerSize.width > 0, containerSize.height > 0 else { return }
        let focalFrame = FocalCropGeometry.renderedFrame(
            imageSize: image.size,
            containerSize: containerSize,
            focalPoint: focalPoint
        )
        let centerFrame = FocalCropGeometry.renderedFrame(
            imageSize: image.size,
            containerSize: containerSize,
            focalPoint: Self.center
        )
        let overflow = CGSize(
            width: max(focalFrame.width - containerSize.width, 0),
            height: max(focalFrame.height - containerSize.height, 0)
        )
        let shiftX = overflow.width > 0
            ? Int(((-(focalFrame.minX - centerFrame.minX) / overflow.width) * 100).rounded())
            : 0
        let shiftY = overflow.height > 0
            ? Int(((-(focalFrame.minY - centerFrame.minY) / overflow.height) * 100).rounded())
            : 0
        Self.logger.debug(
            "Focal crop \(label, privacy: .public): focal x=\(Int((focalPoint.x * 100).rounded()))%, y=\(Int((focalPoint.y * 100).rounded()))%; crop shift x=\(shiftX)%, y=\(shiftY)% (positive is right/down)"
        )
    }

    private func startSaliency(data: Data, key: String, label: String) {
        if focalPoints[key] != nil { return }
        guard saliency[key] == nil else { return }
        let task = Task { [weak self] () -> CGPoint? in
            let point = await Self.suggestedFocalPoint(for: data, label: label)
            guard let self else { return point }
            self.focalPoints[key] = FocalPointResultBox(point)
            self.saliency[key] = nil
            return point
        }
        saliency[key] = task
    }

    /// Coalesced at the URL level rather than the cache-key level so the same file
    /// requested at two different target sizes is still only downloaded once.
    private func data(for url: String) async -> Data? {
        if let inFlight = downloads[url] { return await inFlight.value }
        guard let remote = URL(string: url) else { return nil }

        let task = Task { () -> Data? in
            let started = DispatchTime.now().uptimeNanoseconds
            do {
                let data = try await URLSession.shared.data(from: remote).0
                Self.logger.debug(
                    "Image download \(Self.logLabel(url), privacy: .public): \(Self.elapsedMilliseconds(since: started)) ms, \(data.count / 1_024) KB"
                )
                return data
            } catch {
                Self.logger.error(
                    "Image download failed \(Self.logLabel(url), privacy: .public) after \(Self.elapsedMilliseconds(since: started)) ms: \(error.localizedDescription, privacy: .public)"
                )
                return nil
            }
        }
        downloads[url] = task
        let data = await task.value
        downloads[url] = nil
        return data
    }

    private static func downsample(_ data: Data, maxPixelSize: CGFloat) async -> UIImage? {
        await Task.detached(priority: .utility) {
            let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
            guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions) else {
                return nil
            }
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceShouldCacheImmediately: true,
                kCGImageSourceThumbnailMaxPixelSize: max(maxPixelSize, 1),
            ]
            guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
                return nil
            }
            return UIImage(cgImage: cgImage)
        }.value
    }

    nonisolated static func suggestedFocalPoint(for data: Data, label: String) async -> CGPoint? {
        let queued = DispatchTime.now().uptimeNanoseconds
        return await withCheckedContinuation { (continuation: CheckedContinuation<CGPoint?, Never>) in
            saliencyQueue.async {
                let started = DispatchTime.now().uptimeNanoseconds
                guard let source = CGImageSourceCreateWithData(data as CFData, nil),
                      let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                        kCGImageSourceCreateThumbnailFromImageAlways: true,
                        kCGImageSourceCreateThumbnailWithTransform: true,
                        kCGImageSourceThumbnailMaxPixelSize: saliencyPixelSize,
                      ] as CFDictionary)
                else {
                    logger.debug(
                        "Image saliency \(label, privacy: .public): no analyzable image, queue \(elapsedMilliseconds(from: queued, to: started)) ms, analysis \(elapsedMilliseconds(since: started)) ms"
                    )
                    continuation.resume(returning: nil)
                    return
                }

                do {
                    let request = VNGenerateAttentionBasedSaliencyImageRequest()
                    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
                    guard let observation = request.results?.first,
                          let object = observation.salientObjects?
                            .filter({ $0.confidence >= minimumSaliencyConfidence })
                            .max(by: { $0.confidence < $1.confidence })
                    else {
                        logger.debug(
                            "Image saliency \(label, privacy: .public): center fallback, queue \(elapsedMilliseconds(from: queued, to: started)) ms, analysis \(elapsedMilliseconds(since: started)) ms"
                        )
                        continuation.resume(returning: nil)
                        return
                    }
                    let box = object.boundingBox
                    let point = CGPoint(x: box.midX, y: 1 - box.midY)
                    logger.debug(
                        "Image saliency \(label, privacy: .public): confidence \(Int((object.confidence * 100).rounded()))%, focal x=\(Int((point.x * 100).rounded()))%, y=\(Int((point.y * 100).rounded()))%, queue \(elapsedMilliseconds(from: queued, to: started)) ms, analysis \(elapsedMilliseconds(since: started)) ms"
                    )
                    continuation.resume(returning: point)
                } catch {
                    logger.debug(
                        "Image saliency \(label, privacy: .public): failed after queue \(elapsedMilliseconds(from: queued, to: started)) ms, analysis \(elapsedMilliseconds(since: started)) ms: \(error.localizedDescription, privacy: .public)"
                    )
                    continuation.resume(returning: nil)
                }
            }
        }
    }

    private static func logLabel(_ url: String?) -> String {
        guard let url, let parsed = URL(string: url) else { return "unknown" }
        return parsed.lastPathComponent.removingPercentEncoding ?? parsed.lastPathComponent
    }

    nonisolated private static func elapsedMilliseconds(since start: UInt64) -> Int {
        elapsedMilliseconds(from: start, to: DispatchTime.now().uptimeNanoseconds)
    }

    nonisolated private static func elapsedMilliseconds(from start: UInt64, to end: UInt64) -> Int {
        Int((end - start) / 1_000_000)
    }

    private static func cacheKey(_ url: String, _ targetPoints: CGFloat) -> String {
        "\(url)|\(Int(targetPoints.rounded()))"
    }

    /// Wikimedia thumbnail widths are render variants of one source file, so they share
    /// normalized focal coordinates. Other providers share only exact URLs.
    private static func focalCacheKey(_ url: String) -> String {
        wikimediaFilePageUrl(fromImage: url) ?? url
    }

    private static let center = FocalCropGeometry.center
    nonisolated private static let saliencyPixelSize: CGFloat = 512
    nonisolated private static let minimumSaliencyConfidence: Float = 0.20
    nonisolated private static let logger = Logger(subsystem: Config.bundleID,
                                                  category: "ImageLoader")
    nonisolated private static let saliencyQueue = DispatchQueue(
        label: "com.jlian.wingdex.image-saliency",
        qos: .utility
    )

    /// `UITraitCollection.current` is only populated while a view is updating, so it reads
    /// 0 when a prefetch runs outside that window. The attached window's traits are the
    /// reliable source.
    private static var displayScale: CGFloat {
        let windowScale = UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow?.traitCollection.displayScale }
            .first { $0 > 0 }
        if let windowScale { return windowScale }
        let currentScale = UITraitCollection.current.displayScale
        return currentScale > 0 ? currentScale : 2
    }
}

extension UIImage {
    var decodedByteCost: Int {
        guard let cgImage else { return 1 }
        return cgImage.bytesPerRow * cgImage.height
    }
}
