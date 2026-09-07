@testable import WingDex
import CoreGraphics
import Foundation
import ImageIO
import UIKit
import UniformTypeIdentifiers
import XCTest

final class PhotoServiceTests: XCTestCase {
    private func makeImageData(
        width: Int,
        height: Int,
        type: UTType = .jpeg,
        properties: [CFString: Any] = [:]
    ) throws -> Data {
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let context = try XCTUnwrap(CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: width * 4,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
        ))
        context.setFillColor(red: 0.2, green: 0.5, blue: 0.8, alpha: 1)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let image = try XCTUnwrap(context.makeImage())

        let output = NSMutableData()
        let destination = try XCTUnwrap(CGImageDestinationCreateWithData(
            output,
            type.identifier as CFString,
            1,
            nil
        ))
        CGImageDestinationAddImage(destination, image, properties as CFDictionary)
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        return output as Data
    }

    private func imageDimensions(_ data: Data) throws -> CGSize {
        let source = try XCTUnwrap(CGImageSourceCreateWithData(data as CFData, nil))
        let properties = try XCTUnwrap(
            CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        )
        return CGSize(
            width: try XCTUnwrap(properties[kCGImagePropertyPixelWidth] as? CGFloat),
            height: try XCTUnwrap(properties[kCGImagePropertyPixelHeight] as? CGFloat)
        )
    }

    func testPreparationRecordsOriginalSizeAndDownsamplesThumbnail() throws {
        let original = try makeImageData(width: 1_200, height: 600)
        let prepared = try XCTUnwrap(PhotoService.preparePhoto(from: original))

        XCTAssertEqual(prepared.byteCount, original.count)
        let thumbnailSize = try imageDimensions(prepared.thumbnail)
        XCTAssertEqual(
            max(thumbnailSize.width, thumbnailSize.height),
            PhotoService.displayThumbnailDimension
        )
        XCTAssertEqual(thumbnailSize.width / thumbnailSize.height, 2, accuracy: 0.02)
    }

    func testThumbnailAppliesEXIFOrientation() throws {
        let original = try makeImageData(
            width: 400,
            height: 200,
            properties: [kCGImagePropertyOrientation: 6]
        )
        let prepared = try XCTUnwrap(PhotoService.preparePhoto(from: original, thumbnailDimension: 200))
        let thumbnailSize = try imageDimensions(prepared.thumbnail)

        XCTAssertEqual(thumbnailSize.width, 100)
        XCTAssertEqual(thumbnailSize.height, 200)
    }

    func testPreparationExtractsEXIFDateAndGPS() throws {
        let original = try makeImageData(
            width: 64,
            height: 64,
            properties: [
                kCGImagePropertyExifDictionary: [
                    kCGImagePropertyExifDateTimeOriginal: "2026:08:30 12:34:56",
                ],
                kCGImagePropertyGPSDictionary: [
                    kCGImagePropertyGPSLatitude: 47.61,
                    kCGImagePropertyGPSLatitudeRef: "N",
                    kCGImagePropertyGPSLongitude: 122.33,
                    kCGImagePropertyGPSLongitudeRef: "W",
                ],
            ]
        )
        let prepared = try XCTUnwrap(PhotoService.preparePhoto(from: original))

        XCTAssertNotNil(prepared.exifTime)
        XCTAssertEqual(try XCTUnwrap(prepared.gpsLat), 47.61, accuracy: 0.000_001)
        XCTAssertEqual(try XCTUnwrap(prepared.gpsLon), -122.33, accuracy: 0.000_001)
    }

    func testPreparationPreservesEXIFOffset() throws {
        let original = try makeImageData(width: 64, height: 64, properties: [
            kCGImagePropertyExifDictionary: [
                kCGImagePropertyExifDateTimeOriginal: "2026:08:18 07:13:00",
                kCGImagePropertyExifOffsetTimeOriginal: "-06:00",
            ],
        ])
        let prepared = try XCTUnwrap(PhotoService.preparePhoto(from: original))
        XCTAssertEqual(prepared.captureTime?.storedValue, "2026-08-18T07:13:00-06:00")
        XCTAssertEqual(prepared.exifTime, DateFormatting.sortDate("2026-08-18T13:13:00Z"))
    }

    func testFilePreparationPreservesMetadataAndIdentity() throws {
        let original = try makeImageData(
            width: 1_200,
            height: 600,
            properties: [
                kCGImagePropertyExifDictionary: [
                    kCGImagePropertyExifDateTimeOriginal: "2026:08:30 12:34:56",
                ],
                kCGImagePropertyGPSDictionary: [
                    kCGImagePropertyGPSLatitude: 47.61,
                    kCGImagePropertyGPSLatitudeRef: "N",
                    kCGImagePropertyGPSLongitude: 122.33,
                    kCGImagePropertyGPSLongitudeRef: "W",
                ],
            ]
        )
        let fileURL = try PhotoFlowStore.writeCameraData(original)
        defer { PhotoFlowStore.remove([fileURL]) }

        let prepared = try XCTUnwrap(PhotoService.preparePhoto(at: fileURL))

        XCTAssertEqual(prepared.byteCount, original.count)
        XCTAssertEqual(prepared.fileHash, PhotoService.fileHash(for: original))
        XCTAssertNotNil(prepared.exifTime)
        XCTAssertEqual(try XCTUnwrap(prepared.gpsLat), 47.61, accuracy: 0.000_001)
        XCTAssertEqual(try XCTUnwrap(prepared.gpsLon), -122.33, accuracy: 0.000_001)
        let thumbnailSize = try imageDimensions(prepared.thumbnail)
        XCTAssertEqual(
            max(thumbnailSize.width, thumbnailSize.height),
            PhotoService.displayThumbnailDimension
        )
    }

    func testFilePreparationRejectsInvalidImage() throws {
        let fileURL = try PhotoFlowStore.writeCameraData(Data("not an image".utf8))
        defer { PhotoFlowStore.remove([fileURL]) }

        XCTAssertNil(PhotoService.preparePhoto(at: fileURL))
    }

    func testFileHashUsesPrefixAndFileSize() {
        let prefix = Data(repeating: 7, count: 65_536)
        let first = prefix + Data([1, 2, 3])
        let sameIdentity = prefix + Data([9, 8, 7])
        let differentSize = prefix + Data([1, 2, 3, 4])

        XCTAssertEqual(PhotoService.fileHash(for: first), PhotoService.fileHash(for: sameIdentity))
        XCTAssertNotEqual(PhotoService.fileHash(for: first), PhotoService.fileHash(for: differentSize))
    }

    func testPreparationRejectsInvalidImageData() {
        XCTAssertNil(PhotoService.preparePhoto(from: Data("not an image".utf8)))
    }

    func testProcessingPreservesJPEGAndHEIFWithoutTranscoding() throws {
        for type in [UTType.jpeg, .heic] {
            let original = try makeImageData(
                width: 400, height: 200, type: type,
                properties: [kCGImagePropertyOrientation: 6]
            )
            let fileURL = FileManager.default.temporaryDirectory
                .appendingPathComponent("\(UUID().uuidString).\(try XCTUnwrap(type.preferredFilenameExtension))")
            try original.write(to: fileURL)
            defer { try? FileManager.default.removeItem(at: fileURL) }

            let imported = try PhotoFlowStore.importFile(fileURL)
            defer { PhotoFlowStore.remove([imported]) }
            let prepared = try XCTUnwrap(PhotoService.preparePhoto(at: imported))
            let processing = try PhotoService.processingData(at: imported)

            XCTAssertEqual(processing, original)
            XCTAssertEqual(prepared.fileHash, PhotoService.fileHash(for: original))
            XCTAssertEqual(prepared.byteCount, original.count)
            let decoded = try XCTUnwrap(PhotoDecoder.decode(processing))
            XCTAssertEqual(decoded.width, 200)
            XCTAssertEqual(decoded.height, 400)
            XCTAssertNotNil(UIImage(data: processing)?.cgImage)
        }
    }

    func testProcessingRejectsUnreadableImage() throws {
        let fileURL = try PhotoFlowStore.writeCameraData(Data("not an image".utf8))
        defer { PhotoFlowStore.remove([fileURL]) }
        XCTAssertThrowsError(try PhotoService.processingData(at: fileURL)) { error in
            guard case PhotoService.ProcessingError.unreadableImage = error else {
                return XCTFail("Expected a decoding error, got \(error)")
            }
        }
        XCTAssertThrowsError(try PhotoService.processingData(
            at: fileURL.appendingPathExtension("missing")
        )) { error in
            XCTAssertFalse(error is PhotoService.ProcessingError)
            XCTAssertEqual((error as NSError).domain, NSCocoaErrorDomain)
        }
    }

    @MainActor
    func testRAWNormalizationFeedsIdentificationAndCropRetry() async throws {
        let source = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures/synthetic-bayer.dng")
        let imported = try PhotoFlowStore.importFile(source)
        defer { PhotoFlowStore.remove([imported]) }
        XCTAssertEqual(imported.pathExtension, "dng")
        let rawSource = try XCTUnwrap(CGImageSourceCreateWithURL(imported as CFURL, nil))
        let rawType = try XCTUnwrap(CGImageSourceGetType(rawSource))
        XCTAssertTrue(try XCTUnwrap(UTType(rawType as String)).conforms(to: .rawImage))
        let original = try Data(contentsOf: imported)
        let prepared = try XCTUnwrap(PhotoService.preparePhoto(at: imported))
        let processing = try PhotoService.processingData(at: imported)
        let renderedSource = try XCTUnwrap(CGImageSourceCreateWithData(processing as CFData, nil))
        XCTAssertEqual(CGImageSourceGetType(renderedSource), UTType.jpeg.identifier as CFString)
        let decoded = try XCTUnwrap(PhotoDecoder.decode(processing))
        XCTAssertEqual(decoded.width, 375)
        XCTAssertEqual(decoded.height, 500)
        XCTAssertGreaterThan(Set(decoded.data).count, 16)
        XCTAssertEqual(try XCTUnwrap(UIImage(data: processing)).imageOrientation, .right)
        XCTAssertEqual(try imageDimensions(processing), CGSize(width: 512, height: 384))
        XCTAssertEqual(prepared.byteCount, original.count)
        XCTAssertEqual(prepared.fileHash, PhotoService.fileHash(for: original))
        XCTAssertEqual(try Data(contentsOf: imported), original)

        let auth = AuthService()
        auth.installUITestAnonymousIdentity()
        let store = DataStore(service: UITestDataService(mode: .populated))
        store.activate(accountID: try XCTUnwrap(auth.userId))
        await store.loadAll()
        let viewModel = AddPhotosViewModel()
        viewModel.configure(auth: auth, dataStore: store)
        let photo = ProcessedPhoto(
            id: "raw", originalURL: imported, cleanupOriginal: false,
            thumbnail: prepared.thumbnail, exifTime: nil, gpsLat: nil, gpsLon: nil,
            fileHash: prepared.fileHash, fileName: "synthetic-bayer.dng", byteCount: prepared.byteCount
        )
        viewModel.clusters = [PhotoCluster(
            photos: [photo], startTime: .now, endTime: .now, centerLat: nil, centerLon: nil
        )]
        await viewModel.runSpeciesId(photoIndex: 0)
        XCTAssertNil(viewModel.error)
        let activeData = try XCTUnwrap(viewModel.activeImageData)
        let image = try XCTUnwrap(UIImage(data: activeData)?.cgImage)
        let cropped = try XCTUnwrap(image.cropping(to: CGRect(
            x: 0, y: 0, width: image.width / 2, height: image.height / 2
        )))
        let croppedData = try XCTUnwrap(UIImage(cgImage: cropped).jpegData(compressionQuality: 0.7))
        await viewModel.runSpeciesId(photoIndex: 0, croppedImageData: croppedData)
        XCTAssertNil(viewModel.error)
        XCTAssertEqual(viewModel.activeImageData, activeData)
        await viewModel.cancelSession()
    }
}
