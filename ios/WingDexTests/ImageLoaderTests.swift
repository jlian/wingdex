@testable import WingDex
import UIKit
import XCTest

@MainActor
final class ImageLoaderTests: XCTestCase {
    private let fixtureID = UUID().uuidString
    private var url: String {
        "\(ImageLoaderFixtureURLProtocol.scheme)://fixture/\(fixtureID)/bird.png"
    }

    override func setUp() async throws {
        // Register against an already-created shared session, as used by ImageLoader.
        _ = URLSession.shared
        XCTAssertTrue(URLProtocol.registerClass(ImageLoaderFixtureURLProtocol.self))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let data = UIGraphicsImageRenderer(
            size: CGSize(width: 512, height: 384), format: format
        ).pngData { context in
            UIColor.white.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 512, height: 384))
            UIColor.green.setFill()
            context.cgContext.fillEllipse(in: CGRect(x: 64, y: 96, width: 128, height: 160))
        }
        ImageLoaderFixtureURLProtocol.reset(data: data)
    }

    override func tearDown() async throws {
        URLProtocol.unregisterClass(ImageLoaderFixtureURLProtocol.self)
        ImageLoaderFixtureURLProtocol.reset(data: nil)
    }

    func testDisplayScaleChangesUseSeparateDecodedAndCachedImages() async throws {
        let loader = ImageLoader()
        let twoX = try await image(loader, points: 48, scale: 2)
        XCTAssertNil(loader.cached(url, targetPoints: 48, displayScale: 3))
        let threeX = try await image(loader, points: 48, scale: 3)

        XCTAssertEqual(twoX.cgImage?.width, 96)
        XCTAssertEqual(threeX.cgImage?.width, 144)
        XCTAssertFalse(twoX === threeX)
        XCTAssertTrue(loader.cached(url, targetPoints: 48, displayScale: 2) === twoX)
        XCTAssertTrue(loader.cached(url, targetPoints: 48, displayScale: 3) === threeX)

        // Equal pixel dimensions still retain the requesting view's scale identity.
        XCTAssertNil(loader.cached(url, targetPoints: 72, displayScale: 2))
        let largerTwoX = try await image(loader, points: 72, scale: 2)
        XCTAssertEqual(largerTwoX.cgImage?.width, 144)
        XCTAssertFalse(largerTwoX === threeX)
        XCTAssertTrue(loader.cached(url, targetPoints: 72, displayScale: 2) === largerTwoX)
        XCTAssertTrue(loader.cached(url, targetPoints: 48, displayScale: 3) === threeX)
        XCTAssertEqual(ImageLoaderFixtureURLProtocol.requestCount, 3)
    }

    func testTargetSizeChangesUseSeparateDecodedAndCachedImages() async throws {
        let loader = ImageLoader()
        let thumbnail = try await image(loader, points: 48, scale: 2)
        XCTAssertNil(loader.cached(url, targetPoints: 120, displayScale: 2))
        let hero = try await image(loader, points: 120, scale: 2)

        XCTAssertEqual(thumbnail.cgImage?.width, 96)
        XCTAssertEqual(hero.cgImage?.width, 240)
        XCTAssertFalse(thumbnail === hero)
        XCTAssertTrue(loader.cached(url, targetPoints: 48, displayScale: 2) === thumbnail)
        XCTAssertTrue(loader.cached(url, targetPoints: 120, displayScale: 2) === hero)
        XCTAssertEqual(ImageLoaderFixtureURLProtocol.requestCount, 2)
    }

    func testMatchingSizeAndScaleReuseDecodedImageAndWarmFocalPointCache() async throws {
        let loader = ImageLoader()
        let result = await loader.imageAndFocalPoint(for: url, targetPoints: 48, displayScale: 2)
        let first = try XCTUnwrap(result)
        let second = try await image(loader, points: 48, scale: 2)
        let warm = try XCTUnwrap(
            loader.cachedImageAndFocalPoint(url, targetPoints: 48, displayScale: 2)
        )

        XCTAssertTrue(first.image === second)
        XCTAssertTrue(first.image === warm.image)
        XCTAssertEqual(first.focalPoint, warm.focalPoint)
        XCTAssertEqual(ImageLoaderFixtureURLProtocol.requestCount, 1)
    }

    func testWikimediaVariantsShareSaliencyIdentityAcrossSizesAndScales() async throws {
        let loader = ImageLoader()
        let source = "\(ImageLoaderFixtureURLProtocol.scheme)://fixture/wikipedia/commons/thumb/a/ab/\(fixtureID).png/"
        let thumbnailURL = source + "96px-\(fixtureID).png"
        let heroURL = source + "240px-\(fixtureID).png"
        let canonicalURL = "https://commons.wikimedia.org/wiki/File:\(fixtureID).png"
        let firstResult = await loader.imageAndFocalPoint(
            for: thumbnailURL, targetPoints: 48, displayScale: 2
        )
        let first = try XCTUnwrap(firstResult)
        let originalCache = try focalPointCache(loader)
        let originalIdentity = try XCTUnwrap(originalCache[canonicalURL])
        XCTAssertEqual(Set(originalCache.keys), [canonicalURL])

        for (variant, points, scale) in [
            (thumbnailURL, CGFloat(48), CGFloat(3)),
            (heroURL, CGFloat(120), CGFloat(2)),
        ] {
            let result = await loader.imageAndFocalPoint(
                for: variant, targetPoints: points, displayScale: scale
            )
            let loaded = try XCTUnwrap(result)
            let warm = try XCTUnwrap(
                loader.cachedImageAndFocalPoint(variant, targetPoints: points, displayScale: scale)
            )
            let cache = try focalPointCache(loader)
            let identity = try XCTUnwrap(cache[canonicalURL])

            XCTAssertFalse(first.image === loaded.image)
            XCTAssertTrue(loaded.image === warm.image)
            XCTAssertEqual(first.focalPoint, loaded.focalPoint)
            XCTAssertEqual(first.focalPoint, warm.focalPoint)
            XCTAssertEqual(Set(cache.keys), [canonicalURL])
            XCTAssertTrue(identity === originalIdentity)
        }
        XCTAssertTrue(
            loader.cached(thumbnailURL, targetPoints: 48, displayScale: 2) === first.image
        )
        XCTAssertEqual(ImageLoaderFixtureURLProtocol.requestCount, 3)
    }

    private func image(_ loader: ImageLoader, points: CGFloat, scale: CGFloat) async throws -> UIImage {
        let result = await loader.image(for: url, targetPoints: points, displayScale: scale)
        return try XCTUnwrap(result)
    }

    private func focalPointCache(_ loader: ImageLoader) throws -> [String: AnyObject] {
        // Observe result identity without exposing private Vision state in production.
        let cache = Mirror(reflecting: loader).children.first { $0.label == "focalPoints" }?.value
        return try XCTUnwrap(cache as? [String: AnyObject])
    }
}

private final class ImageLoaderFixtureURLProtocol: URLProtocol, @unchecked Sendable {
    static let scheme = "wingdex-image-loader-tests"
    private static let lock = NSLock()
    nonisolated(unsafe) private static var data: Data?
    nonisolated(unsafe) private static var requests = 0

    static var requestCount: Int { lock.withLock { requests } }

    static func reset(data: Data?) {
        lock.withLock {
            self.data = data
            requests = 0
        }
    }

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.scheme == scheme
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let data = Self.lock.withLock {
            Self.requests += 1
            return Self.data
        }
        guard let data, let url = request.url else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }
        client?.urlProtocol(self, didReceive: URLResponse(
            url: url, mimeType: "image/png", expectedContentLength: data.count,
            textEncodingName: nil
        ), cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
