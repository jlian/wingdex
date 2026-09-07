@testable import WingDex
import ImageIO
import UIKit
import XCTest

@MainActor
final class CameraCaptureTests: XCTestCase {
    private func capture(
        latitude: Double? = 15.23, longitude: Double? = -90.23, metadata: [String: Any] = [:]
    ) throws -> CameraCapture {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let image = UIGraphicsImageRenderer(size: CGSize(width: 640, height: 480), format: format).image { context in
            UIColor.green.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 640, height: 480))
        }
        return try CameraCapture.make(
            image: image, metadata: metadata, latitude: latitude, longitude: longitude,
            capturedAt: DateFormatting.sortDate("2026-08-18T13:13:00Z"),
            timeZone: TimeZone(identifier: "America/Guatemala")!
        )
    }

    func testCapturePreservesFullResolutionTimeAndLocation() throws {
        let capture = try capture()
        let source = try XCTUnwrap(CGImageSourceCreateWithData(capture.data as CFData, nil))
        let properties = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any])
        XCTAssertEqual(properties[kCGImagePropertyPixelWidth] as? Int, 640)
        XCTAssertEqual(properties[kCGImagePropertyPixelHeight] as? Int, 480)
        let prepared = try XCTUnwrap(PhotoService.preparePhoto(from: capture.data))
        XCTAssertEqual(prepared.captureTime?.storedValue, "2026-08-18T07:13:00-06:00")
        XCTAssertEqual(prepared.gpsLat, 15.23)
        XCTAssertEqual(prepared.gpsLon, -90.23)
        XCTAssertNil(capture.captureTime.localDateTime)
    }

    func testCaptureWorksWithoutLocationPermission() throws {
        let capture = try capture(latitude: nil, longitude: nil)
        let prepared = try XCTUnwrap(PhotoService.preparePhoto(from: capture.data))
        XCTAssertNil(prepared.gpsLat)
        XCTAssertNil(prepared.gpsLon)
        XCTAssertEqual(prepared.exifTime, capture.captureTime.date)
    }

    func testCameraMetadataKeepsShutterTimeInsteadOfAcceptanceTime() throws {
        let capture = try capture(metadata: [kCGImagePropertyExifDictionary as String: [
            kCGImagePropertyExifDateTimeOriginal: "2026:08:18 06:55:00",
            kCGImagePropertyExifOffsetTimeOriginal: "-06:00",
        ]])
        XCTAssertEqual(capture.captureTime.storedValue, "2026-08-18T06:55:00-06:00")
        XCTAssertNil(capture.captureTime.localDateTime)
    }

    func testCaptureDoesNotRetainUnapprovedLocationMetadata() throws {
        let capture = try capture(latitude: nil, longitude: nil, metadata: [
            kCGImagePropertyGPSDictionary as String: [
                kCGImagePropertyGPSLatitude: 15.23, kCGImagePropertyGPSLatitudeRef: "N",
                kCGImagePropertyGPSLongitude: 90.23, kCGImagePropertyGPSLongitudeRef: "W",
            ] as [CFString: Any],
        ])
        let prepared = try XCTUnwrap(PhotoService.preparePhoto(from: capture.data))
        XCTAssertNil(prepared.gpsLat)
        XCTAssertNil(prepared.gpsLon)
    }

    func testDisabledSavingNeverCallsPhotosAndAnAcceptedCaptureSavesOnce() async throws {
        var saved: [CameraCapture] = []
        let saver = CameraPhotoSaver { saved.append($0) }
        let capture = try capture()
        let disabled = try await saver.save(capture, enabled: false)
        XCTAssertFalse(disabled)
        XCTAssertTrue(saved.isEmpty)
        let first = try await saver.save(capture, enabled: true)
        let repeated = try await saver.save(capture, enabled: true)
        XCTAssertTrue(first)
        XCTAssertFalse(repeated)
        XCTAssertEqual(saved.count, 1)
        XCTAssertEqual(saved.first?.data, capture.data)
    }

    func testInFlightCaptureIsNotSavedTwice() async throws {
        var pendingSave: CheckedContinuation<Void, Never>?
        let saver = CameraPhotoSaver { _ in
            await withCheckedContinuation { pendingSave = $0 }
        }
        let capture = try capture()
        let first = Task { try await saver.save(capture, enabled: true) }
        while pendingSave == nil { await Task.yield() }
        let repeated = try await saver.save(capture, enabled: true)
        XCTAssertFalse(repeated)
        pendingSave?.resume()
        let saved = try await first.value
        XCTAssertTrue(saved)
    }

    func testSaveFailureDoesNotDiscardTheCaptureOrMarkItSaved() async throws {
        var attempts = 0
        let saver = CameraPhotoSaver { _ in
            attempts += 1
            if attempts == 1 { throw ImageSharingError.photoLibraryAccessDenied }
        }
        let capture = try capture()
        do {
            _ = try await saver.save(capture, enabled: true)
            XCTFail("Expected denied Photos access")
        } catch ImageSharingError.photoLibraryAccessDenied {}
        let retried = try await saver.save(capture, enabled: true)
        XCTAssertTrue(retried)
        XCTAssertFalse(capture.data.isEmpty)
    }
}
