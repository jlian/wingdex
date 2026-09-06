@testable import WingDex
import ImageIO
import XCTest

@MainActor
final class AddPhotosViewModelTests: XCTestCase {
    func testClusterTimeZoneResolutionUpdatesPhotosAndBounds() throws {
        let fallbackTimeZone = TimeZone(secondsFromGMT: 0)!
        let rawTime = try XCTUnwrap(PhotoCaptureTime.fromEXIF([
            kCGImagePropertyExifDateTimeOriginal: "2026:08:18 07:13:00",
        ], fallbackTimeZone: fallbackTimeZone))
        let photo = ProcessedPhoto(
            id: "naive", originalURL: URL(fileURLWithPath: #filePath), cleanupOriginal: false,
            thumbnail: Data(), exifTime: rawTime.date, gpsLat: 15.23, gpsLon: -90.23,
            fileHash: "naive", fileName: "naive.jpg", byteCount: 0, captureTime: rawTime
        )
        let viewModel = AddPhotosViewModel()
        viewModel.processedPhotos = [photo]
        viewModel.clusters = [PhotoCluster(
            photos: [photo], startTime: rawTime.date, endTime: rawTime.date, centerLat: 15.23, centerLon: -90.23
        )]
        viewModel.resolveCurrentClusterTimeZone(TimeZone(identifier: "America/Guatemala")!)
        let expected = DateFormatting.sortDate("2026-08-18T13:13:00Z")
        XCTAssertEqual(viewModel.clusters[0].startTime, expected)
        XCTAssertEqual(viewModel.clusters[0].endTime, expected)
        XCTAssertEqual(viewModel.currentPhoto?.exifTime, expected)
        XCTAssertEqual(viewModel.processedPhotos[0].captureTime?.storedValue, "2026-08-18T07:13:00-06:00")
        viewModel.resolveCurrentClusterTimeZone(fallbackTimeZone)
        XCTAssertEqual(viewModel.currentPhoto?.exifTime, rawTime.date)
    }

    func testHistoricalNameIsNotPrefilledAndConfirmedDeviceCoordinatesFeedInference() async throws {
        let previousGeoContext = UserDefaults.standard.object(forKey: "useGeoContext")
        defer { UserDefaults.standard.set(previousGeoContext, forKey: "useGeoContext") }
        let auth = AuthService()
        auth.installUITestAnonymousIdentity()
        let store = DataStore(service: UITestDataService(mode: .populated))
        store.activate(accountID: try XCTUnwrap(auth.userId))
        await store.loadAll()
        XCTAssertFalse(store.outings.isEmpty)
        let viewModel = AddPhotosViewModel()
        viewModel.configure(auth: auth, dataStore: store)
        XCTAssertEqual(viewModel.lastLocationName, "")
        let photo = ProcessedPhoto(
            id: "no-gps", originalURL: URL(fileURLWithPath: #filePath), cleanupOriginal: false,
            thumbnail: Data(), exifTime: nil, gpsLat: nil, gpsLon: nil,
            fileHash: "no-gps", fileName: "no-gps.jpg", byteCount: 0
        )
        viewModel.clusters = [PhotoCluster(
            photos: [photo], startTime: .now, endTime: .now, centerLat: nil, centerLon: nil
        )]
        viewModel.useGeoContext = true
        viewModel.outingConfirmed(
            outing: nil, outingId: "confirmed", locationName: " Current Park ",
            lat: 47.7115123, lon: -122.3717456, outingOverridesPhotoGPS: true
        )
        XCTAssertEqual(viewModel.lastLocationName, "Current Park")
        XCTAssertEqual(viewModel.currentInferenceLocation?.lat, 47.7115123)
        XCTAssertEqual(viewModel.currentInferenceLocation?.lon, -122.3717456)
        XCTAssertNil(viewModel.currentPhoto?.gpsLat)
        XCTAssertNil(viewModel.currentPhoto?.gpsLon)
        viewModel.useGeoContext = false
        XCTAssertNil(viewModel.currentInferenceLocation)
        await viewModel.cancelSession()
    }

    func testAccountChangeResetsAndDismissesActiveFlow() async throws {
        let auth = AuthService()
        auth.userId = "account-a"
        let store = DataStore(service: DataService(auth: auth))
        store.activate(accountID: "account-a")
        let viewModel = AddPhotosViewModel()
        viewModel.configure(auth: auth, dataStore: store)

        let fileURL = try PhotoFlowStore.writeCameraData(Data("photo".utf8))
        let photo = ProcessedPhoto(
            id: "photo",
            originalURL: fileURL,
            cleanupOriginal: true,
            thumbnail: Data(),
            exifTime: nil,
            gpsLat: nil,
            gpsLon: nil,
            fileHash: "hash",
            fileName: "photo.jpg",
            byteCount: 5
        )
        viewModel.processedPhotos = [photo]
        viewModel.clusters = [PhotoCluster(
            photos: [photo],
            startTime: .now,
            endTime: .now,
            centerLat: nil,
            centerLon: nil
        )]
        viewModel.currentStep = .outingReview
        viewModel.isProcessing = true
        let dismissalRequestID = viewModel.flowDismissalRequestID

        auth.userId = "account-b"
        store.activate(accountID: "account-b")
        viewModel.configure(auth: auth, dataStore: store)

        XCTAssertEqual(viewModel.currentStep, .selectPhotos)
        XCTAssertTrue(viewModel.processedPhotos.isEmpty)
        XCTAssertTrue(viewModel.clusters.isEmpty)
        XCTAssertFalse(viewModel.isProcessing)
        XCTAssertTrue(viewModel.stoppedShareQueueAfterDismissal)
        XCTAssertNotEqual(viewModel.flowDismissalRequestID, dismissalRequestID)
        XCTAssertFalse(FileManager.default.fileExists(atPath: fileURL.path))
        await viewModel.cancelSession()
    }
}
