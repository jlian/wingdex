@testable import WingDex
import ImageIO
import PhotosUI
import SwiftUI
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

    private func configuredModel(
        _ viewModel: AddPhotosViewModel = AddPhotosViewModel()
    ) async throws -> (AddPhotosViewModel, DataStore) {
        let auth = AuthService()
        auth.installUITestAnonymousIdentity()
        let store = DataStore(service: UITestDataService(mode: .populated))
        store.activate(accountID: try XCTUnwrap(auth.userId))
        await store.loadAll()
        viewModel.configure(auth: auth, dataStore: store)
        return (viewModel, store)
    }

    private func cameraImage() -> UIImage {
        UIGraphicsImageRenderer(size: CGSize(width: 40, height: 40)).image { context in
            UIColor.blue.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 40, height: 40))
        }
    }

    private func identificationPhotos(_ viewModel: AddPhotosViewModel) throws {
        let data = try XCTUnwrap(cameraImage().jpegData(compressionQuality: 0.8))
        let url = try PhotoFlowStore.writeCameraData(data)
        viewModel.clusters = [PhotoCluster(
            photos: (0..<2).map { index in
                ProcessedPhoto(
                    id: "photo-\(index)", originalURL: url, cleanupOriginal: true,
                    thumbnail: data, exifTime: nil, gpsLat: nil, gpsLon: nil,
                    fileHash: "\(index)", fileName: "\(index).jpg", byteCount: data.count
                )
            },
            startTime: .now, endTime: .now, centerLat: nil, centerLon: nil
        )]
    }

    private static func identificationResult(_ name: String) -> [BirdIdEngine.Result] {
        [.init(commonName: name, scientificName: "Test bird", taxonIdx: 0,
               confidence: 0.95, logP: nil, pBird: 0.99)]
    }

    @MainActor
    private final class PendingIdentification {
        var requests: [CheckedContinuation<[BirdIdEngine.Result], Error>] = []

        func identify() async throws -> [BirdIdEngine.Result] {
            try await withCheckedThrowingContinuation { requests.append($0) }
        }

        func waitForRequests(_ count: Int) async throws {
            for _ in 0..<1_000 {
                if requests.count >= count { return }
                try await Task.sleep(for: .milliseconds(1))
            }
            XCTFail("Identification did not start")
            throw CancellationError()
        }
    }

    func testFastIdentificationWithCachedImagePublishesNewSameCountCandidates() async throws {
        var calls = 0
        let (model, _) = try await configuredModel(AddPhotosViewModel(identify: { _, _, _ in
            calls += 1
            return Self.identificationResult("Bird \(calls)")
        }))
        try identificationPhotos(model)
        await model.runSpeciesId(photoIndex: 0)
        XCTAssertEqual(model.currentStep, .perPhotoConfirm)
        XCTAssertEqual(model.currentCandidates.first?.species, "Bird 1 (Test bird)")
        let image = try XCTUnwrap(model.activeImageData)

        // Removing the source proves the next request uses the decoded-image cache.
        PhotoFlowStore.remove([try XCTUnwrap(model.currentPhoto?.originalURL)])
        await model.runSpeciesId(photoIndex: 0)
        XCTAssertEqual(model.currentStep, .perPhotoConfirm)
        XCTAssertEqual(model.currentCandidates.first?.species, "Bird 2 (Test bird)")
        XCTAssertEqual(model.activeImageData, image)
        XCTAssertNil(model.error)
        await model.cancelSession()
    }

    func testBackDuringIdentificationIgnoresLateSuccessAndFailure() async throws {
        for fails in [false, true] {
            let pending = PendingIdentification()
            let (model, _) = try await configuredModel(AddPhotosViewModel(identify: { _, _, _ in
                try await pending.identify()
            }))
            try identificationPhotos(model)
            let request = Task { await model.runSpeciesId(photoIndex: 0) }
            try await pending.waitForRequests(1)
            XCTAssertEqual(model.currentStep, .photoProcessing)
            model.returnToOutingReview()
            if fails {
                pending.requests[0].resume(throwing: CocoaError(.fileReadUnknown))
            } else {
                pending.requests[0].resume(returning: Self.identificationResult("Stale"))
            }
            await request.value
            XCTAssertEqual(model.currentStep, .outingReview)
            XCTAssertTrue(model.currentCandidates.isEmpty)
            XCTAssertNil(model.error)
            XCTAssertNil(model.activeImageData)
            await model.cancelSession()
        }
    }

    func testBackStartsProcessingSynchronouslyAndRejectsSupersededSamePhotoResult() async throws {
        let pending = PendingIdentification()
        let (model, _) = try await configuredModel(AddPhotosViewModel(identify: { _, _, _ in
            try await pending.identify()
        }))
        try identificationPhotos(model)
        let oldRequest = Task { await model.runSpeciesId(photoIndex: 0) }
        try await pending.waitForRequests(1)
        model.currentPhotoIndex = 1
        model.currentStep = .perPhotoConfirm
        model.currentCandidates = [.init(species: "Previous", confidence: 0.9, wikiTitle: nil, plumage: nil)]
        model.goBackToPreviousPhoto()
        XCTAssertEqual(model.currentStep, .photoProcessing)
        XCTAssertEqual(model.currentPhotoIndex, 0)
        XCTAssertTrue(model.currentCandidates.isEmpty)
        try await pending.waitForRequests(2)
        pending.requests[1].resume(returning: Self.identificationResult("Current"))
        for _ in 0..<1_000 {
            if model.currentStep == .perPhotoConfirm { break }
            try await Task.sleep(for: .milliseconds(1))
        }
        XCTAssertEqual(model.currentStep, .perPhotoConfirm)
        pending.requests[0].resume(returning: Self.identificationResult("Stale"))
        await oldRequest.value
        XCTAssertEqual(model.currentCandidates.first?.species, "Current (Test bird)")
        XCTAssertNil(model.error)
        await model.cancelSession()
    }

    func testBackBeforeQueuedIdentificationStartsDoesNotReenterFlow() async throws {
        var calls = 0
        let (model, _) = try await configuredModel(AddPhotosViewModel(identify: { _, _, _ in
            calls += 1
            return Self.identificationResult("Unexpected")
        }))
        try identificationPhotos(model)
        model.reidentifyCurrentPhoto()
        XCTAssertEqual(model.currentStep, .photoProcessing)
        model.returnToOutingReview()
        for _ in 0..<10 { await Task.yield() }
        XCTAssertEqual(model.currentStep, .outingReview)
        XCTAssertEqual(calls, 0)
        await model.cancelSession()
    }

    private func cameraCapture(_ image: UIImage) throws -> CameraCapture {
        try CameraCapture.make(image: image, metadata: [:], latitude: nil, longitude: nil)
    }

    private func cameraCapture(data: Data) -> CameraCapture {
        CameraCapture(
            id: UUID(),
            data: data,
            captureTime: PhotoCaptureTime(date: .now, timeZone: .current),
            latitude: nil,
            longitude: nil
        )
    }

    func testFailedPickerItemsAreCountedAndCanBeRetried() async throws {
        let (viewModel, _) = try await configuredModel()
        viewModel.selectedItems = [
            PhotosPickerItem(itemIdentifier: "unavailable-photo-1"),
            PhotosPickerItem(itemIdentifier: "unavailable-photo-2"),
        ]

        await viewModel.processSelectedPhotos()

        XCTAssertEqual(viewModel.currentStep, .selectPhotos)
        XCTAssertFalse(viewModel.isProcessing)
        XCTAssertTrue(viewModel.processedPhotos.isEmpty)
        XCTAssertEqual(viewModel.processedCount, 2)
        XCTAssertEqual(viewModel.error?.message,
            "2 photos could not be prepared. Select or share them again, or export JPEG or HEIF copies and try again.")
        XCTAssertTrue(viewModel.canRetryError)
        XCTAssertEqual(viewModel.selectedItems.count, 2)
        await viewModel.cancelSession()
    }

    func testFailedPickerItemDoesNotDiscardGoodPhoto() async throws {
        let (viewModel, _) = try await configuredModel()
        viewModel.selectedItems = [PhotosPickerItem(itemIdentifier: "unavailable-photo")]
        viewModel.addCameraPhoto(try cameraCapture(cameraImage()))

        await viewModel.processSelectedPhotos()

        XCTAssertEqual(viewModel.currentStep, .outingReview)
        XCTAssertEqual(viewModel.processedPhotos.count, 1)
        XCTAssertEqual(viewModel.processedCount, 2)
        XCTAssertEqual(viewModel.error?.message,
            "One photo could not be prepared. Select or share it again, or export a JPEG or HEIF copy and try again.")
        XCTAssertFalse(viewModel.canRetryError)
        let originalURL = try XCTUnwrap(viewModel.processedPhotos.first?.originalURL)
        XCTAssertTrue(FileManager.default.fileExists(atPath: originalURL.path))
        await viewModel.cancelSession()
        XCTAssertFalse(FileManager.default.fileExists(atPath: originalURL.path))
    }

    func testRejectedPhotoWarningSurvivesBothDuplicateChoices() async throws {
        for reimport in [false, true] {
            let (viewModel, store) = try await configuredModel()
            let image = cameraImage()
            let data = try XCTUnwrap(PhotoService.compressImage(image, quality: 0.7))
            store.photos.append(Photo(
                id: "duplicate", outingId: "existing", dataUrl: "", thumbnail: "",
                fileHash: PhotoService.fileHash(for: data), fileName: "existing.jpg"
            ))
            viewModel.selectedItems = [PhotosPickerItem(itemIdentifier: "unavailable-photo")]
            viewModel.addCameraPhoto(cameraCapture(data: data))

            await viewModel.processSelectedPhotos()

            XCTAssertTrue(viewModel.showDuplicateConfirm)
            XCTAssertNil(viewModel.error)
            let originalURL = try XCTUnwrap(viewModel.pendingDuplicatePhotos.first?.originalURL)
            await viewModel.handleDuplicateChoice(reimport: reimport)

            XCTAssertFalse(viewModel.showDuplicateConfirm)
            XCTAssertEqual(viewModel.currentStep, reimport ? .outingReview : .selectPhotos)
            XCTAssertEqual(viewModel.processedPhotos.count, reimport ? 1 : 0)
            XCTAssertEqual(viewModel.error?.message,
                "One photo could not be prepared. Select or share it again, or export a JPEG or HEIF copy and try again.")
            XCTAssertEqual(FileManager.default.fileExists(atPath: originalURL.path), reimport)
            await viewModel.cancelSession()
            XCTAssertFalse(FileManager.default.fileExists(atPath: originalURL.path))
        }
    }

    func testUndecodablePhotoOffersExportOrSkipWithoutRetry() async throws {
        let (viewModel, _) = try await configuredModel()
        let fileURL = try PhotoFlowStore.writeCameraData(Data("not an image".utf8))
        defer { PhotoFlowStore.remove([fileURL]) }
        viewModel.clusters = [PhotoCluster(
            photos: [ProcessedPhoto(
                id: "invalid", originalURL: fileURL, cleanupOriginal: false,
                thumbnail: Data(), exifTime: nil, gpsLat: nil, gpsLon: nil,
                fileHash: "invalid", fileName: "invalid.dng", byteCount: 12
            )],
            startTime: .now, endTime: .now, centerLat: nil, centerLon: nil
        )]
        await viewModel.runSpeciesId(photoIndex: 0)

        XCTAssertEqual(viewModel.error?.message,
            "This photo could not be decoded on this device. Export a JPEG or HEIF copy and try again, or skip it.")
        XCTAssertEqual(viewModel.currentStep, .perPhotoConfirm)
        XCTAssertFalse(viewModel.canRetryError)
        XCTAssertTrue(viewModel.currentCandidates.isEmpty)
        XCTAssertNil(viewModel.activeImageData)
        XCTAssertTrue(FileManager.default.fileExists(atPath: fileURL.path))
        await viewModel.cancelSession()
    }

    func testMissingPhotoCanRetryAfterFileIsRestored() async throws {
        let (viewModel, _) = try await configuredModel()
        let data = try XCTUnwrap(PhotoService.compressImage(cameraImage()))
        let fileURL = try PhotoFlowStore.writeCameraData(data)
        defer { PhotoFlowStore.remove([fileURL]) }
        PhotoFlowStore.remove([fileURL])
        viewModel.clusters = [PhotoCluster(
            photos: [ProcessedPhoto(
                id: "retry", originalURL: fileURL, cleanupOriginal: false,
                thumbnail: data, exifTime: nil, gpsLat: nil, gpsLon: nil,
                fileHash: "retry", fileName: "retry.jpg", byteCount: data.count
            )],
            startTime: .now, endTime: .now, centerLat: nil, centerLon: nil
        )]
        await viewModel.runSpeciesId(photoIndex: 0)

        XCTAssertEqual(viewModel.error?.message, "Could not read this photo. Try again or skip it.")
        XCTAssertEqual(viewModel.currentStep, .perPhotoConfirm)
        XCTAssertTrue(viewModel.canRetryError)
        XCTAssertNil(viewModel.activeImageData)

        try data.write(to: fileURL)
        viewModel.retryCurrentError()
        for _ in 0..<1_000 {
            if viewModel.activeImageData != nil && viewModel.currentStep != .photoProcessing { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertNil(viewModel.error)
        XCTAssertEqual(viewModel.activeImageData, data)
        XCTAssertFalse(viewModel.canRetryError)
        XCTAssertNotEqual(viewModel.currentStep, .photoProcessing)
        await viewModel.cancelSession()
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

    func testGoBackToPreviousPhotoPreservesConfirmedResultWhenPreviousSkipped() async throws {
        let (viewModel, _) = try await configuredModel()
        let photos = ["p0", "p1", "p2"].map { id in
            ProcessedPhoto(
                id: id, originalURL: URL(fileURLWithPath: "/unused/\(id).jpg"),
                cleanupOriginal: false, thumbnail: Data(), exifTime: nil,
                gpsLat: nil, gpsLon: nil, fileHash: id, fileName: "\(id).jpg", byteCount: 0
            )
        }
        viewModel.clusters = [PhotoCluster(
            photos: photos, startTime: .now, endTime: .now, centerLat: nil, centerLon: nil
        )]
        viewModel.currentPhotoIndex = 0

        // Photo 0 confirmed
        viewModel.confirmCurrentPhoto(
            species: "Song Sparrow (Melospiza melodia)",
            confidence: 0.95,
            status: .confirmed,
            count: 1
        )
        XCTAssertEqual(viewModel.photoResults.count, 1)
        XCTAssertEqual(viewModel.photoResults[0].photoId, "p0")
        XCTAssertEqual(viewModel.photoResults[0].status, .confirmed)

        // Photo 1 skipped
        viewModel.skipCurrentPhoto()
        XCTAssertEqual(viewModel.photoResults.count, 2)
        XCTAssertEqual(viewModel.photoResults[1].photoId, "p1")
        XCTAssertEqual(viewModel.photoResults[1].status, .rejected)

        // Now on Photo 2, go back to Photo 1
        viewModel.goBackToPreviousPhoto()
        // Photo 1's decision is removed for re-decision, Photo 0's confirmed result is preserved!
        XCTAssertEqual(viewModel.photoResults.count, 1)
        XCTAssertEqual(viewModel.photoResults[0].photoId, "p0")
        XCTAssertEqual(viewModel.photoResults[0].status, .confirmed)

        await viewModel.cancelSession()
    }

    func testReturnToOutingReviewPreservesPositionAndDecisions() async throws {
        let (viewModel, _) = try await configuredModel()
        let photos = ["p0", "p1"].map { id in
            ProcessedPhoto(
                id: id, originalURL: URL(fileURLWithPath: "/unused/\(id).jpg"),
                cleanupOriginal: false, thumbnail: Data(), exifTime: nil,
                gpsLat: nil, gpsLon: nil, fileHash: id, fileName: "\(id).jpg", byteCount: 0
            )
        }
        viewModel.clusters = [PhotoCluster(
            photos: photos, startTime: .now, endTime: .now, centerLat: nil, centerLon: nil
        )]
        viewModel.outingConfirmed(
            outing: nil, outingId: "outing-test-1", locationName: "First Park",
            lat: 47.7, lon: -122.3, outingOverridesPhotoGPS: false
        )
        // Confirm first photo
        viewModel.confirmCurrentPhoto(
            species: "Bald Eagle (Haliaeetus leucocephalus)",
            confidence: 0.9,
            status: .confirmed,
            count: 1
        )
        XCTAssertEqual(viewModel.currentPhotoIndex, 1)
        XCTAssertEqual(viewModel.photoResults.count, 1)

        // Return to outing review
        viewModel.returnToOutingReview()
        XCTAssertEqual(viewModel.currentStep, .outingReview)

        // Outing edited and re-confirmed for same cluster
        viewModel.outingConfirmed(
            outing: nil, outingId: "outing-test-1", locationName: "Updated Park",
            lat: 48.0, lon: -122.5, outingOverridesPhotoGPS: true
        )
        // Position and earlier results are preserved
        XCTAssertEqual(viewModel.currentPhotoIndex, 1)
        XCTAssertEqual(viewModel.photoResults.count, 1)
        XCTAssertEqual(viewModel.photoResults[0].photoId, "p0")
        XCTAssertEqual(viewModel.photoResults[0].status, .confirmed)
        XCTAssertEqual(viewModel.lastLocationName, "Updated Park")
        XCTAssertEqual(viewModel.currentInferenceLocation?.lat, 48.0)

        await viewModel.cancelSession()
    }

    func testCurrentOutingStartTimeFallsBackToCluster() {
        let viewModel = AddPhotosViewModel()
        let now = Date(timeIntervalSince1970: 1770000000)
        let cluster = PhotoCluster(
            photos: [], startTime: now, endTime: now, centerLat: nil, centerLon: nil
        )
        viewModel.clusters = [cluster]
        XCTAssertEqual(viewModel.currentOutingStartTime.map(DateFormatting.sortDate), now)
    }

    func testSuccessiveClustersSharingSameOutingDoNotResumePreviousCluster() async throws {
        let (viewModel, _) = try await configuredModel()
        let photos1 = ["c1_p0"].map { id in
            ProcessedPhoto(
                id: id, originalURL: URL(fileURLWithPath: "/unused/\(id).jpg"),
                cleanupOriginal: false, thumbnail: Data(), exifTime: nil,
                gpsLat: nil, gpsLon: nil, fileHash: id, fileName: "\(id).jpg", byteCount: 0
            )
        }
        let photos2 = ["c2_p0", "c2_p1"].map { id in
            ProcessedPhoto(
                id: id, originalURL: URL(fileURLWithPath: "/unused/\(id).jpg"),
                cleanupOriginal: false, thumbnail: Data(), exifTime: nil,
                gpsLat: nil, gpsLon: nil, fileHash: id, fileName: "\(id).jpg", byteCount: 0
            )
        }
        viewModel.clusters = [
            PhotoCluster(photos: photos1, startTime: .now, endTime: .now, centerLat: nil, centerLon: nil),
            PhotoCluster(photos: photos2, startTime: .now.addingTimeInterval(86400), endTime: .now.addingTimeInterval(86400), centerLat: nil, centerLon: nil)
        ]

        // Cluster 0 confirmed into existing outing
        viewModel.outingConfirmed(
            outing: nil, outingId: "shared-existing-outing", locationName: "Shared Park",
            lat: 47.7, lon: -122.3, outingOverridesPhotoGPS: false, useExistingOuting: true
        )
        viewModel.confirmCurrentPhoto(species: "Song Sparrow", confidence: 0.9, status: .confirmed, count: 1)
        XCTAssertEqual(viewModel.photoResults.count, 1)

        // Advance to cluster 1
        viewModel.currentClusterIndex = 1
        viewModel.currentPhotoIndex = 0

        // Cluster 1 also merges into same existing outing "shared-existing-outing"
        // But because confirmedClusterID != cluster2.id, it must NOT resume cluster 0!
        viewModel.outingConfirmed(
            outing: nil, outingId: "shared-existing-outing", locationName: "Shared Park",
            lat: 47.7, lon: -122.3, outingOverridesPhotoGPS: false, useExistingOuting: true
        )

        // Cluster 1 must be clean and not treat itself as resuming cluster 0
        XCTAssertEqual(viewModel.currentPhotoIndex, 0)
        XCTAssertEqual(viewModel.photoResults.count, 0)

        await viewModel.cancelSession()
    }

    func testPhotoRemovalPreservesPhotoIdentityAndOtherResults() async throws {
        let (viewModel, _) = try await configuredModel()
        let photos = ["p0", "p1", "p2"].map { id in
            ProcessedPhoto(
                id: id, originalURL: URL(fileURLWithPath: "/unused/\(id).jpg"),
                cleanupOriginal: false, thumbnail: Data(), exifTime: nil,
                gpsLat: nil, gpsLon: nil, fileHash: id, fileName: "\(id).jpg", byteCount: 0
            )
        }
        viewModel.clusters = [PhotoCluster(
            photos: photos, startTime: .now, endTime: .now, centerLat: nil, centerLon: nil
        )]
        viewModel.outingConfirmed(
            outing: nil, outingId: "test-outing", locationName: "Test Park",
            lat: nil, lon: nil, outingOverridesPhotoGPS: false
        )
        // Confirm p0, now on p1 (index 1)
        viewModel.confirmCurrentPhoto(species: "Robin", confidence: 0.9, status: .confirmed, count: 1)
        XCTAssertEqual(viewModel.currentPhotoIndex, 1)
        XCTAssertEqual(viewModel.currentPhoto?.id, "p1")
        XCTAssertEqual(viewModel.photoResults.count, 1)

        // Remove p0 from cluster
        await viewModel.removePhotoFromCurrentCluster(id: "p0")

        // p1 should still be current photo, now at index 0
        XCTAssertEqual(viewModel.clusterPhotos.count, 2)
        XCTAssertEqual(viewModel.currentPhoto?.id, "p1")
        XCTAssertEqual(viewModel.currentPhotoIndex, 0)
        // p0's result was removed
        XCTAssertEqual(viewModel.photoResults.count, 0)

        await viewModel.cancelSession()
    }

    func testCurrentOutingStartTimePreservesPendingOutingTimezone() async throws {
        let (viewModel, _) = try await configuredModel()
        let now = Date(timeIntervalSince1970: 1770000000)
        let cluster = PhotoCluster(
            photos: [], startTime: now, endTime: now, centerLat: nil, centerLon: nil
        )
        viewModel.clusters = [cluster]
        let hawaiiOuting = Outing(
            id: "out-hi", userId: "u1",
            startTime: "2026-02-01T23:00:00-10:00",
            endTime: "2026-02-02T01:00:00-10:00",
            locationName: "Kapiolani Park", defaultLocationName: "Kapiolani Park",
            lat: 21.27, lon: -157.82, stateProvince: "HI", countryCode: "US",
            notes: "", createdAt: "2026-02-01T23:00:00Z"
        )
        viewModel.outingConfirmed(
            outing: hawaiiOuting, outingId: hawaiiOuting.id, locationName: hawaiiOuting.locationName,
            lat: hawaiiOuting.lat, lon: hawaiiOuting.lon, outingOverridesPhotoGPS: false
        )
        XCTAssertEqual(viewModel.currentOutingStartTime, "2026-02-01T23:00:00-10:00")
        await viewModel.cancelSession()
    }

    func testSkippedPhotosAreExcludedFromPhotoMetadataPayload() async throws {
        let (viewModel, _) = try await configuredModel()
        let photos = ["p0", "p1"].map { id in
            ProcessedPhoto(
                id: id, originalURL: URL(fileURLWithPath: "/unused/\(id).jpg"),
                cleanupOriginal: false, thumbnail: Data(), exifTime: nil,
                gpsLat: nil, gpsLon: nil, fileHash: id, fileName: "\(id).jpg", byteCount: 0
            )
        }
        viewModel.clusters = [PhotoCluster(
            photos: photos, startTime: .now, endTime: .now, centerLat: nil, centerLon: nil
        )]
        viewModel.outingConfirmed(
            outing: nil, outingId: "outing-skip-test", locationName: "Test Park",
            lat: nil, lon: nil, outingOverridesPhotoGPS: false
        )
        // Confirm first photo
        viewModel.confirmCurrentPhoto(species: "Robin", confidence: 0.9, status: .confirmed, count: 1)
        // Skip second photo
        viewModel.skipCurrentPhoto()

        let payloads = viewModel.photoMetadata(outingId: "outing-skip-test")
        XCTAssertEqual(payloads.map(\.id), ["p0"])

        await viewModel.cancelSession()
    }
}
