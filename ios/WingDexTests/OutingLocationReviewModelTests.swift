import CoreLocation
import Observation
import XCTest
@testable import WingDex

// MARK: - Test Doubles

private final class ContinuationBox<T: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<T, Error>?

    func set(_ c: CheckedContinuation<T, Error>?) {
        lock.withLock { continuation = c }
    }

    func resume(with result: Result<T, Error>) {
        let c = lock.withLock { () -> CheckedContinuation<T, Error>? in
            let saved = continuation
            continuation = nil
            return saved
        }
        c?.resume(with: result)
    }
}

@MainActor
private final class MockGeocodingLookup: LocationReverseGeocodingLookup {
    typealias ReverseOutcome = (result: GeocodingResult?, nearby: [GeocodingResult], regionCodes: GeocodingService.RegionCodes?, timeZone: String?)

    var reverseResult: ReverseOutcome = (nil, [], nil, nil)
    var reverseError: Error?
    private(set) var reverseCalls: [(lat: Double, lon: Double)] = []

    var shouldSuspend = false
    private let continuationBox = ContinuationBox<ReverseOutcome>()
    var onReverseStarted: (((lat: Double, lon: Double)) -> Void)?

    func reverse(
        latitude: Double,
        longitude: Double
    ) async throws -> ReverseOutcome {
        reverseCalls.append((latitude, longitude))
        onReverseStarted?((latitude, longitude))

        if shouldSuspend {
            return try await withCheckedThrowingContinuation { continuation in
                self.continuationBox.set(continuation)
            }
        }

        try Task.checkCancellation()
        if let reverseError {
            throw reverseError
        }
        return reverseResult
    }

    func resumePending(with result: Result<ReverseOutcome, Error>) {
        continuationBox.resume(with: result)
    }
}

@MainActor
private final class MockCurrentLocationRequester: CurrentLocationRequesting {
    var resultCoordinate: CLLocationCoordinate2D?
    var requestError: Error?
    private(set) var requestCalls = 0
    private(set) var cancelCalls = 0

    var shouldSuspend = false
    private let continuationBox = ContinuationBox<CLLocationCoordinate2D>()
    var onRequestStarted: (() -> Void)?

    func request() async throws -> CLLocationCoordinate2D {
        requestCalls += 1
        onRequestStarted?()

        if shouldSuspend {
            return try await withCheckedThrowingContinuation { continuation in
                self.continuationBox.set(continuation)
            }
        }

        try Task.checkCancellation()
        if let requestError {
            throw requestError
        }
        guard let resultCoordinate else {
            throw CurrentLocationError.unavailable
        }
        return resultCoordinate
    }

    func resumePending(with result: Result<CLLocationCoordinate2D, Error>) {
        continuationBox.resume(with: result)
    }

    func cancel() {
        cancelCalls += 1
    }
}

// MARK: - Tests

@MainActor
final class OutingLocationReviewModelTests: XCTestCase {

    private func makeCluster(
        lat: Double? = 47.7115123456,
        lon: Double? = -122.3717456789,
        photosCount: Int = 1,
        timeZone: TimeZone = TimeZone(identifier: "America/Los_Angeles")!
    ) -> PhotoCluster {
        let captureTime = PhotoCaptureTime(
            date: Date(timeIntervalSince1970: 1720000000),
            timeZone: timeZone
        )
        let photos = (0..<photosCount).map { i in
            ProcessedPhoto(
                id: "photo-\(i)",
                originalURL: URL(string: "file:///photo-\(i).jpg")!,
                cleanupOriginal: false,
                thumbnail: Data(),
                exifTime: captureTime.date,
                gpsLat: lat,
                gpsLon: lon,
                fileHash: "hash-\(i)",
                fileName: "photo-\(i).jpg",
                byteCount: 100,
                captureTime: captureTime
            )
        }
        return PhotoCluster(
            photos: photos,
            startTime: captureTime.date,
            endTime: captureTime.date,
            centerLat: lat,
            centerLon: lon
        )
    }

    private func waitUntil(
        timeout: Duration = .seconds(2),
        predicate: @MainActor () -> Bool
    ) async -> Bool {
        let clock = ContinuousClock()
        let deadline = clock.now + timeout
        while clock.now < deadline {
            if predicate() {
                return true
            }
            await Task.yield()
        }
        return predicate()
    }

    // MARK: - Initial Configuration and Precision

    func testCanceledSourceLookupCanBeRestoredAndRetried() async {
        let lookup = MockGeocodingLookup()
        lookup.shouldSuspend = true
        let model = OutingLocationReviewModel(geocodingLookup: lookup)
        model.configure(for: makeCluster(), useGeoContext: true)
        let started = await waitUntil { lookup.reverseCalls.count == 1 }
        XCTAssertTrue(started)

        model.cancelAllWork()
        XCTAssertEqual(model.lookupState, .paused)
        XCTAssertFalse(model.isLoadingLocation)
        model.commitManualName("My birding spot")
        model.restoreSourceSuggestion()
        XCTAssertEqual(model.lookupState, .paused)

        lookup.resumePending(with: .failure(CancellationError()))
        lookup.shouldSuspend = false
        model.retryReverseGeocoding()
        let retried = await waitUntil { lookup.reverseCalls.count == 2 && !model.isLoadingLocation }
        XCTAssertTrue(retried)
        XCTAssertEqual(model.lookupState, .empty)
    }

    func testInitialConfigurationPreservesExactCoordinatesWithoutRounding() {
        let mockGeocoding = MockGeocodingLookup()
        let model = OutingLocationReviewModel(geocodingLookup: mockGeocoding)

        let exactLat = 47.711512345678
        let exactLon = -122.371745678901
        let cluster = makeCluster(lat: exactLat, lon: exactLon)

        model.configure(for: cluster, useGeoContext: false)

        XCTAssertEqual(model.acceptedSelection.coordinate?.latitude, exactLat)
        XCTAssertEqual(model.acceptedSelection.coordinate?.longitude, exactLon)
        XCTAssertEqual(model.acceptedSelection.source, .photoGPS)
        XCTAssertFalse(model.acceptedSelection.overridesPhotoGPS)
        XCTAssertEqual(model.acceptedSelection.name, "47.712\u{00B0}, -122.372\u{00B0}")
        XCTAssertEqual(model.sourceSuggestion?.coordinate.latitude, exactLat)
        XCTAssertEqual(model.sourceSuggestion?.coordinate.longitude, exactLon)
        XCTAssertTrue(mockGeocoding.reverseCalls.isEmpty)
    }

    func testInitialConfigurationWithoutGPSLeavesSelectionEmpty() {
        let mockGeocoding = MockGeocodingLookup()
        let model = OutingLocationReviewModel(geocodingLookup: mockGeocoding)

        let cluster = makeCluster(lat: nil, lon: nil)
        model.configure(for: cluster, useGeoContext: true)

        XCTAssertNil(model.acceptedSelection.coordinate)
        XCTAssertEqual(model.acceptedSelection.name, "")
        XCTAssertEqual(model.acceptedSelection.source, .manual)
        XCTAssertNil(model.sourceSuggestion)
        XCTAssertFalse(model.acceptedSelection.overridesPhotoGPS)
        XCTAssertTrue(mockGeocoding.reverseCalls.isEmpty)
        XCTAssertTrue(model.canRequestCurrentLocation)
    }

    func testDisabledGeoContextDoesNotTriggerAutomaticReverseLookup() {
        let mockGeocoding = MockGeocodingLookup()
        let model = OutingLocationReviewModel(geocodingLookup: mockGeocoding)

        let cluster = makeCluster(lat: 47.7115, lon: -122.3717)
        model.configure(for: cluster, useGeoContext: false)

        XCTAssertFalse(model.isLoadingLocation)
        XCTAssertTrue(mockGeocoding.reverseCalls.isEmpty)
    }

    func testFallbackTimeZoneConfiguration() {
        let mockGeocoding = MockGeocodingLookup()
        let model = OutingLocationReviewModel(geocodingLookup: mockGeocoding)

        // 1. Explicit fallback timezone provided to configure
        let explicitTZ = TimeZone(identifier: "Asia/Tokyo")!
        let cluster1 = makeCluster(lat: 47.7, lon: -122.3)
        model.configure(for: cluster1, useGeoContext: false, fallbackTimeZone: explicitTZ)
        XCTAssertEqual(model.fallbackTimeZone, explicitTZ)

        // 2. Fallback timezone nil, resolved from photo capture time
        let clusterTZ = TimeZone(identifier: "America/New_York")!
        let cluster2 = makeCluster(lat: 47.7, lon: -122.3, timeZone: clusterTZ)
        model.configure(for: cluster2, useGeoContext: false, fallbackTimeZone: nil, forceReset: true)
        XCTAssertEqual(model.fallbackTimeZone, clusterTZ)
    }

    // MARK: - Cluster Switching, UUID Tracking, and Force Reset

    func testClusterUUIDSwitchCancelsPriorWorkAndResetsState() async {
        let mockGeocoding = MockGeocodingLookup()
        mockGeocoding.shouldSuspend = true

        let model = OutingLocationReviewModel(geocodingLookup: mockGeocoding)
        let cluster1 = makeCluster(lat: 47.7, lon: -122.3)
        model.configure(for: cluster1, useGeoContext: true)

        let started1 = await waitUntil { mockGeocoding.reverseCalls.count == 1 }
        XCTAssertTrue(started1)
        XCTAssertTrue(model.isLoadingLocation)

        // Switch to cluster2 (different UUID)
        let cluster2 = makeCluster(lat: 34.0, lon: -118.0)
        model.configure(for: cluster2, useGeoContext: false)

        XCTAssertFalse(model.isLoadingLocation)
        XCTAssertEqual(model.acceptedSelection.coordinate?.latitude, 34.0)
        XCTAssertEqual(model.acceptedSelection.coordinate?.longitude, -118.0)

        // Late completion from cluster1 must not overwrite cluster2
        let staleResult = GeocodingResult(
            label: "Stale Park", context: nil,
            latitude: 47.7, longitude: -122.3,
            stateProvince: "US-WA", countryCode: "US"
        )
        mockGeocoding.resumePending(with: .success((result: staleResult, nearby: [], regionCodes: nil, timeZone: nil)))

        await Task.yield()
        XCTAssertEqual(model.acceptedSelection.coordinate?.latitude, 34.0)
        XCTAssertEqual(model.acceptedSelection.name, "34.0\u{00B0}, -118.0\u{00B0}")
    }

    func testSameClusterUUIDWithoutForceResetPreservesState() {
        let mockGeocoding = MockGeocodingLookup()
        let model = OutingLocationReviewModel(geocodingLookup: mockGeocoding)

        let cluster = makeCluster(lat: 47.7115, lon: -122.3717)
        model.configure(for: cluster, useGeoContext: false)

        model.commitManualName("Custom Spot Name")
        XCTAssertEqual(model.acceptedSelection.name, "Custom Spot Name")

        // Re-configure with same cluster UUID and forceReset = false must be a no-op
        model.configure(for: cluster, useGeoContext: false, forceReset: false)
        XCTAssertEqual(model.acceptedSelection.name, "Custom Spot Name")
    }

    func testSameClusterUUIDWithForceResetForcesReconfiguration() {
        let mockGeocoding = MockGeocodingLookup()
        let model = OutingLocationReviewModel(geocodingLookup: mockGeocoding)

        let cluster = makeCluster(lat: 47.7115, lon: -122.3717)
        model.configure(for: cluster, useGeoContext: false)

        model.commitManualName("Custom Spot Name")
        XCTAssertEqual(model.acceptedSelection.name, "Custom Spot Name")

        // Re-configure with same cluster UUID and forceReset = true resets selection
        model.configure(for: cluster, useGeoContext: false, forceReset: true)
        XCTAssertEqual(model.acceptedSelection.name, "47.712\u{00B0}, -122.372\u{00B0}")
    }

    func testResetClusterStateClearsActiveClusterAndSelection() {
        let mockGeocoding = MockGeocodingLookup()
        let model = OutingLocationReviewModel(geocodingLookup: mockGeocoding)

        let cluster = makeCluster(lat: 47.7115, lon: -122.3717)
        model.configure(for: cluster, useGeoContext: false)
        XCTAssertNotNil(model.activeClusterID)

        model.resetClusterState()

        XCTAssertNil(model.activeClusterID)
        XCTAssertNil(model.acceptedSelection.coordinate)
        XCTAssertEqual(model.acceptedSelection.name, "")
        XCTAssertEqual(model.acceptedSelection.source, .manual)
        XCTAssertNil(model.sourceSuggestion)
        XCTAssertEqual(model.lookupState, .ok)
    }

    // MARK: - Reverse Geocoding Lookup

    func testSuccessfulReverseGeocodingAppliesResultPreservingExactCoordinate() async {
        let mockGeocoding = MockGeocodingLookup()
        let result = GeocodingResult(
            label: "Carkeek Park",
            context: "Seattle, WA",
            latitude: 47.712,
            longitude: -122.372,
            stateProvince: "US-WA",
            countryCode: "US",
            timeZone: "America/Los_Angeles"
        )
        mockGeocoding.reverseResult = (
            result: result,
            nearby: [result],
            regionCodes: .init(stateProvince: "US-WA", countryCode: "US"),
            timeZone: "America/Los_Angeles"
        )

        let model = OutingLocationReviewModel(geocodingLookup: mockGeocoding)
        let exactLat = 47.7115123
        let exactLon = -122.3717456
        let cluster = makeCluster(lat: exactLat, lon: exactLon)

        model.configure(for: cluster, useGeoContext: true)

        let finished = await waitUntil { !model.isLoadingLocation }
        XCTAssertTrue(finished)

        XCTAssertEqual(model.acceptedSelection.name, "Carkeek Park")
        XCTAssertEqual(model.acceptedSelection.coordinate?.latitude, exactLat)
        XCTAssertEqual(model.acceptedSelection.coordinate?.longitude, exactLon)
        XCTAssertEqual(model.acceptedSelection.stateProvince, "US-WA")
        XCTAssertEqual(model.acceptedSelection.countryCode, "US")
        XCTAssertEqual(model.acceptedSelection.timeZone?.identifier, "America/Los_Angeles")
        XCTAssertFalse(model.acceptedSelection.overridesPhotoGPS)
        XCTAssertEqual(model.lookupState, .ok)

        XCTAssertEqual(mockGeocoding.reverseCalls.first?.lat, exactLat)
        XCTAssertEqual(mockGeocoding.reverseCalls.first?.lon, exactLon)
    }

    func testReverseGeocodingPreservesManualNameIfAlreadyEdited() async {
        let mockGeocoding = MockGeocodingLookup()
        mockGeocoding.shouldSuspend = true

        let model = OutingLocationReviewModel(geocodingLookup: mockGeocoding)
        let cluster = makeCluster(lat: 47.7115, lon: -122.3717)
        model.configure(for: cluster, useGeoContext: true)

        let started = await waitUntil { mockGeocoding.reverseCalls.count == 1 }
        XCTAssertTrue(started)

        // User enters a manual name while reverse geocoding is in flight
        let source = model.sourceSuggestion
        model.commitManualName("Custom User Park")
        XCTAssertEqual(model.acceptedSelection.name, "Custom User Park")
        let unchanged = expectation(description: "Canceled reverse lookup cannot change selection or source")
        unchanged.isInverted = true
        withObservationTracking {
            _ = model.acceptedSelection
            _ = model.sourceSuggestion
        } onChange: {
            unchanged.fulfill()
        }

        // Reverse lookup completes
        let result = GeocodingResult(
            label: "Geocoded Park", context: nil,
            latitude: 47.71, longitude: -122.37,
            stateProvince: "US-WA", countryCode: "US",
            timeZone: "America/Los_Angeles"
        )
        mockGeocoding.resumePending(with: .success((
            result: result,
            nearby: [result],
            regionCodes: .init(stateProvince: "US-WA", countryCode: "US"),
            timeZone: "America/Los_Angeles"
        )))

        await fulfillment(of: [unchanged], timeout: 0.1)

        // User manual name must not be overwritten
        XCTAssertEqual(model.acceptedSelection.name, "Custom User Park")
        XCTAssertEqual(model.sourceSuggestion, source)
    }

    func testEmptyReverseGeocodingSetsEmptyStateWithRegionCodes() async {
        let mockGeocoding = MockGeocodingLookup()
        mockGeocoding.reverseResult = (
            result: nil,
            nearby: [],
            regionCodes: .init(stateProvince: "US-WA", countryCode: "US"),
            timeZone: "America/Los_Angeles"
        )

        let model = OutingLocationReviewModel(geocodingLookup: mockGeocoding)
        let cluster = makeCluster(lat: 47.711512, lon: -122.371745)
        model.configure(for: cluster, useGeoContext: true)

        let finished = await waitUntil { !model.isLoadingLocation }
        XCTAssertTrue(finished)

        XCTAssertEqual(model.acceptedSelection.name, "47.712\u{00B0}, -122.372\u{00B0}")
        XCTAssertEqual(model.acceptedSelection.stateProvince, "US-WA")
        XCTAssertEqual(model.acceptedSelection.countryCode, "US")
        XCTAssertEqual(model.acceptedSelection.timeZone?.identifier, "America/Los_Angeles")
        XCTAssertEqual(model.lookupState, .empty)
    }

    func testFailedReverseGeocodingSetsErrorState() async {
        let mockGeocoding = MockGeocodingLookup()
        mockGeocoding.reverseError = GeocodingServiceError.server(statusCode: 500, traceID: "test-trace")

        let model = OutingLocationReviewModel(geocodingLookup: mockGeocoding)
        let cluster = makeCluster(lat: 47.711512, lon: -122.371745)
        model.configure(for: cluster, useGeoContext: true)

        let finished = await waitUntil { !model.isLoadingLocation }
        XCTAssertTrue(finished)

        XCTAssertEqual(model.lookupState, .error)
        XCTAssertFalse(model.isLoadingLocation)
    }

    func testRetryReverseGeocodingRestoresAndRetries() async {
        let mockGeocoding = MockGeocodingLookup()
        mockGeocoding.reverseError = GeocodingServiceError.server(statusCode: 500, traceID: "test-trace")

        let model = OutingLocationReviewModel(geocodingLookup: mockGeocoding)
        let cluster = makeCluster(lat: 47.711512, lon: -122.371745)
        model.configure(for: cluster, useGeoContext: true)

        let initialFailed = await waitUntil { model.lookupState == .error }
        XCTAssertTrue(initialFailed)
        XCTAssertEqual(mockGeocoding.reverseCalls.count, 1)

        // Fix error and retry
        mockGeocoding.reverseError = nil
        let successResult = GeocodingResult(
            label: "Retried Park", context: nil,
            latitude: 47.71, longitude: -122.37,
            stateProvince: "US-WA", countryCode: "US"
        )
        mockGeocoding.reverseResult = (successResult, [successResult], nil, nil)

        model.retryReverseGeocoding()
        let retried = await waitUntil { model.lookupState == .ok && !model.isLoadingLocation }
        XCTAssertTrue(retried)
        XCTAssertEqual(mockGeocoding.reverseCalls.count, 2)
        XCTAssertEqual(model.acceptedSelection.name, "Retried Park")
    }

    // MARK: - Commit Transitions

    func testCommitPlaceSearchSelectionOverridesPhotoGPSAndAppliesCentroid() {
        let mockGeocoding = MockGeocodingLookup()
        let model = OutingLocationReviewModel(geocodingLookup: mockGeocoding)
        let cluster = makeCluster(lat: 47.7115, lon: -122.3717)
        model.configure(for: cluster, useGeoContext: false)

        let searchPlace = GeocodingResult(
            label: "Discovery Park",
            context: "Seattle, WA",
            latitude: 47.6573,
            longitude: -122.4066,
            stateProvince: "US-WA",
            countryCode: "US",
            timeZone: "America/Los_Angeles"
        )

        let committed = model.commitPlaceSearchSelection(searchPlace)
        XCTAssertTrue(committed)
        XCTAssertEqual(model.acceptedSelection.name, "Discovery Park")
        XCTAssertEqual(model.acceptedSelection.coordinate?.latitude, 47.6573)
        XCTAssertEqual(model.acceptedSelection.coordinate?.longitude, -122.4066)
        XCTAssertEqual(model.acceptedSelection.source, .placeSearch)
        XCTAssertTrue(model.acceptedSelection.overridesPhotoGPS)
        XCTAssertEqual(model.acceptedSelection.stateProvince, "US-WA")
        XCTAssertEqual(model.acceptedSelection.countryCode, "US")
        XCTAssertEqual(model.acceptedSelection.timeZone?.identifier, "America/Los_Angeles")
    }

    func testCommitPlaceSearchSelectionWithInvalidCoordinatesRejectedPreservingAccepted() {
        let mockGeocoding = MockGeocodingLookup()
        let model = OutingLocationReviewModel(geocodingLookup: mockGeocoding)
        let exactLat = 47.7115
        let exactLon = -122.3717
        let cluster = makeCluster(lat: exactLat, lon: exactLon)
        model.configure(for: cluster, useGeoContext: false)

        let invalidPlace = GeocodingResult(
            label: "Invalid Place",
            context: nil,
            latitude: 999.0,
            longitude: 999.0,
            stateProvince: nil,
            countryCode: nil
        )

        let committed = model.commitPlaceSearchSelection(invalidPlace)
        XCTAssertFalse(committed)
        XCTAssertEqual(model.acceptedSelection.coordinate?.latitude, exactLat)
        XCTAssertEqual(model.acceptedSelection.coordinate?.longitude, exactLon)
        XCTAssertEqual(model.acceptedSelection.source, .photoGPS)
        XCTAssertFalse(model.acceptedSelection.overridesPhotoGPS)
        XCTAssertNotNil(model.currentLocationError)
    }

    func testCommitNearbySelectionPreservesSourceCoordinateAndSourceTimeZone() {
        let mockGeocoding = MockGeocodingLookup()
        let model = OutingLocationReviewModel(geocodingLookup: mockGeocoding)
        let exactLat = 47.71151234
        let exactLon = -122.37174567
        let cluster = makeCluster(lat: exactLat, lon: exactLon)
        model.configure(for: cluster, useGeoContext: false)

        let nearbyPlace = GeocodingResult(
            label: "Nearby Beach",
            context: "Seattle, WA",
            latitude: 47.7150,
            longitude: -122.3750,
            stateProvince: "US-WA",
            countryCode: "US",
            timeZone: "Europe/London" // Should be ignored in favor of source timeZone
        )

        model.commitNearbySelection(nearbyPlace)

        XCTAssertEqual(model.acceptedSelection.name, "Nearby Beach")
        XCTAssertEqual(model.acceptedSelection.coordinate?.latitude, exactLat)
        XCTAssertEqual(model.acceptedSelection.coordinate?.longitude, exactLon)
        XCTAssertEqual(model.acceptedSelection.source, .photoGPS)
        XCTAssertFalse(model.acceptedSelection.overridesPhotoGPS)
        XCTAssertEqual(model.acceptedSelection.stateProvince, "US-WA")
        XCTAssertNil(model.acceptedSelection.timeZone)
    }

    func testCommitNearbySelectionForCurrentLocationMaintainsOverridesPhotoGPS() async {
        let mockGeocoding = MockGeocodingLookup()
        let mockLocation = MockCurrentLocationRequester()
        let fixCoord = CLLocationCoordinate2D(latitude: 47.7115, longitude: -122.3717)
        mockLocation.resultCoordinate = fixCoord

        let model = OutingLocationReviewModel(
            geocodingLookup: mockGeocoding,
            currentLocationRequester: mockLocation
        )
        let cluster = makeCluster(lat: nil, lon: nil)
        model.configure(for: cluster, useGeoContext: false)

        model.requestCurrentLocation()
        let located = await waitUntil { !model.isLocatingCurrentLocation && model.acceptedSelection.coordinate != nil }
        XCTAssertTrue(located)
        XCTAssertTrue(model.acceptedSelection.overridesPhotoGPS)

        // Nearby selection for current location must retain overridesPhotoGPS = true
        let nearby = GeocodingResult(
            label: "Nearby Pier", context: nil,
            latitude: 47.7, longitude: -122.3,
            stateProvince: "US-WA", countryCode: "US"
        )
        model.commitNearbySelection(nearby)
        XCTAssertEqual(model.acceptedSelection.name, "Nearby Pier")
        XCTAssertEqual(model.acceptedSelection.source, .currentLocation)
        XCTAssertTrue(model.acceptedSelection.overridesPhotoGPS)
    }

    func testCommitManualNamePreservesCoordinatesAndMetadata() {
        let mockGeocoding = MockGeocodingLookup()
        let model = OutingLocationReviewModel(geocodingLookup: mockGeocoding)
        let exactLat = 47.71151234
        let exactLon = -122.37174567
        let cluster = makeCluster(lat: exactLat, lon: exactLon)
        model.configure(for: cluster, useGeoContext: false)

        model.commitManualName(" My Custom Backyard ")

        XCTAssertEqual(model.acceptedSelection.name, "My Custom Backyard")
        XCTAssertEqual(model.acceptedSelection.coordinate?.latitude, exactLat)
        XCTAssertEqual(model.acceptedSelection.coordinate?.longitude, exactLon)
        XCTAssertEqual(model.acceptedSelection.source, .photoGPS)
        XCTAssertFalse(model.acceptedSelection.overridesPhotoGPS)
    }

    func testCommitManualNamePreservesAcceptedSourceAcrossAllProvenances() async {
        let mockGeocoding = MockGeocodingLookup()
        let mockLocation = MockCurrentLocationRequester()
        let model = OutingLocationReviewModel(
            geocodingLookup: mockGeocoding,
            currentLocationRequester: mockLocation
        )

        // 1. Photo GPS
        let cluster = makeCluster(lat: 47.71, lon: -122.37)
        model.configure(for: cluster, useGeoContext: false)
        model.commitManualName("Custom Backyard")
        XCTAssertEqual(model.acceptedSelection.source, .photoGPS)
        XCTAssertEqual(model.acceptedSelection.name, "Custom Backyard")

        // 2. Place Search
        let searchPlace = GeocodingResult(
            label: "Search Spot",
            context: "WA",
            latitude: 47.6,
            longitude: -122.4,
            stateProvince: "US-WA",
            countryCode: "US"
        )
        model.commitPlaceSearchSelection(searchPlace)
        XCTAssertEqual(model.acceptedSelection.source, .placeSearch)
        model.commitManualName("Custom Search Spot")
        XCTAssertEqual(model.acceptedSelection.source, .placeSearch)
        XCTAssertEqual(model.acceptedSelection.name, "Custom Search Spot")
        XCTAssertEqual(model.acceptedSelection.coordinate?.latitude, 47.6)

        // 3. Current Location
        let emptyCluster = makeCluster(lat: nil, lon: nil)
        model.configure(for: emptyCluster, useGeoContext: false)
        mockLocation.resultCoordinate = CLLocationCoordinate2D(latitude: 47.65, longitude: -122.35)
        model.requestCurrentLocation()
        let located = await waitUntil { !model.isLocatingCurrentLocation && model.acceptedSelection.coordinate != nil }
        XCTAssertTrue(located)
        XCTAssertEqual(model.acceptedSelection.source, .currentLocation)

        model.commitManualName("Custom Current Spot")
        XCTAssertEqual(model.acceptedSelection.source, .currentLocation)
        XCTAssertEqual(model.acceptedSelection.name, "Custom Current Spot")
        XCTAssertEqual(model.acceptedSelection.coordinate?.latitude, 47.65)
    }

    func testRestoreSourceSuggestionRestoresAllMetadataTogether() {
        let mockGeocoding = MockGeocodingLookup()
        let model = OutingLocationReviewModel(geocodingLookup: mockGeocoding)
        let exactLat = 47.71151234
        let exactLon = -122.37174567
        let cluster = makeCluster(lat: exactLat, lon: exactLon)
        model.configure(for: cluster, useGeoContext: false)

        let searchPlace = GeocodingResult(
            label: "Discovery Park",
            context: "Seattle, WA",
            latitude: 47.6573,
            longitude: -122.4066,
            stateProvince: "US-WA",
            countryCode: "US",
            timeZone: "America/Los_Angeles"
        )
        model.commitPlaceSearchSelection(searchPlace)
        XCTAssertTrue(model.acceptedSelection.overridesPhotoGPS)

        model.restoreSourceSuggestion()

        XCTAssertEqual(model.acceptedSelection.name, "47.712\u{00B0}, -122.372\u{00B0}")
        XCTAssertEqual(model.acceptedSelection.coordinate?.latitude, exactLat)
        XCTAssertEqual(model.acceptedSelection.coordinate?.longitude, exactLon)
        XCTAssertEqual(model.acceptedSelection.source, .photoGPS)
        XCTAssertFalse(model.acceptedSelection.overridesPhotoGPS)
    }

    func testRestoreSourceSuggestionRestoresEmptyLookupState() async {
        let mockGeocoding = MockGeocodingLookup()
        mockGeocoding.reverseResult = (
            result: nil,
            nearby: [],
            regionCodes: .init(stateProvince: "US-WA", countryCode: "US"),
            timeZone: "America/Los_Angeles"
        )

        let model = OutingLocationReviewModel(geocodingLookup: mockGeocoding)
        let cluster = makeCluster(lat: 47.711512, lon: -122.371745)
        model.configure(for: cluster, useGeoContext: true)

        let finished = await waitUntil { !model.isLoadingLocation }
        XCTAssertTrue(finished)
        XCTAssertEqual(model.lookupState, .empty)

        // User enters a manual name, which resets lookupState to .ok
        model.commitManualName("Custom Spot")
        XCTAssertEqual(model.lookupState, .ok)

        // Restoring source suggestion must restore original .empty lookup state
        model.restoreSourceSuggestion()
        XCTAssertEqual(model.lookupState, .empty)
    }

    func testRestoreSourceSuggestionRestoresErrorLookupState() async {
        let mockGeocoding = MockGeocodingLookup()
        mockGeocoding.reverseError = GeocodingServiceError.server(statusCode: 500, traceID: "test-err")

        let model = OutingLocationReviewModel(geocodingLookup: mockGeocoding)
        let cluster = makeCluster(lat: 47.711512, lon: -122.371745)
        model.configure(for: cluster, useGeoContext: true)

        let finished = await waitUntil { !model.isLoadingLocation }
        XCTAssertTrue(finished)
        XCTAssertEqual(model.lookupState, .error)

        // User enters a manual name, resetting lookupState to .ok
        model.commitManualName("Custom Spot")
        XCTAssertEqual(model.lookupState, .ok)

        // Restoring source suggestion must restore original .error lookup state
        model.restoreSourceSuggestion()
        XCTAssertEqual(model.lookupState, .error)
    }

    func testRestoreSourceSuggestionRestoresCurrentLocationFailedReverseLookupState() async {
        let mockGeocoding = MockGeocodingLookup()
        mockGeocoding.reverseError = GeocodingServiceError.server(statusCode: 500, traceID: "cur-err")

        let mockLocation = MockCurrentLocationRequester()
        let fixCoord = CLLocationCoordinate2D(latitude: 47.7115, longitude: -122.3717)
        mockLocation.resultCoordinate = fixCoord

        let model = OutingLocationReviewModel(
            geocodingLookup: mockGeocoding,
            currentLocationRequester: mockLocation
        )
        let cluster = makeCluster(lat: nil, lon: nil)
        model.configure(for: cluster, useGeoContext: false)

        var committed = false
        model.requestCurrentLocation(onCommit: { committed = true })

        let located = await waitUntil { !model.isLocatingCurrentLocation && model.acceptedSelection.coordinate != nil }
        XCTAssertTrue(located)
        XCTAssertTrue(committed)
        XCTAssertEqual(model.lookupState, .error)

        // User commits a manual name, resetting lookupState to .ok
        model.commitManualName("Renamed Current Spot")
        XCTAssertEqual(model.lookupState, .ok)

        // Restoring source suggestion must restore the reverse-failed .error lookupState
        model.restoreSourceSuggestion()
        XCTAssertEqual(model.lookupState, .error)
        XCTAssertEqual(model.acceptedSelection.source, .currentLocation)
        XCTAssertTrue(model.acceptedSelection.overridesPhotoGPS)
    }

    // MARK: - Current Location (Atomic Commit & Noncooperative Cancellation)

    func testCurrentLocationUnavailableWhenPhotosHaveGPS() {
        let mockGeocoding = MockGeocodingLookup()
        let mockLocation = MockCurrentLocationRequester()
        let model = OutingLocationReviewModel(
            geocodingLookup: mockGeocoding,
            currentLocationRequester: mockLocation
        )
        let cluster = makeCluster(lat: 47.7115, lon: -122.3717)
        model.configure(for: cluster, useGeoContext: false)

        XCTAssertFalse(model.canRequestCurrentLocation)

        model.requestCurrentLocation()
        XCTAssertFalse(model.isLocatingCurrentLocation)
        XCTAssertEqual(mockLocation.requestCalls, 0)
    }

    func testCurrentLocationFixCommitsAtomicallyAfterReverseLookupAndInvokesOnCommit() async {
        let mockGeocoding = MockGeocodingLookup()
        mockGeocoding.shouldSuspend = true

        let mockLocation = MockCurrentLocationRequester()
        let fixCoord = CLLocationCoordinate2D(latitude: 47.71159988, longitude: -122.37179988)
        mockLocation.resultCoordinate = fixCoord

        let model = OutingLocationReviewModel(
            geocodingLookup: mockGeocoding,
            currentLocationRequester: mockLocation
        )
        let cluster = makeCluster(lat: nil, lon: nil)
        model.configure(for: cluster, useGeoContext: false)

        var committed = false
        model.requestCurrentLocation(onCommit: {
            committed = true
        })
        XCTAssertTrue(model.isLocatingCurrentLocation)

        // Wait until location fix arrives and reverse lookup begins
        let lookupStarted = await waitUntil { mockGeocoding.reverseCalls.count == 1 }
        XCTAssertTrue(lookupStarted)

        // Selection must not mutate prematurely before reverse lookup completes
        XCTAssertNil(model.acceptedSelection.coordinate)
        XCTAssertFalse(committed)

        // Complete reverse lookup
        let geocodedResult = GeocodingResult(
            label: "Ballard Locks", context: "Seattle, WA",
            latitude: 47.7116, longitude: -122.3718,
            stateProvince: "US-WA", countryCode: "US", timeZone: "America/Los_Angeles"
        )
        mockGeocoding.resumePending(with: .success((
            result: geocodedResult,
            nearby: [geocodedResult],
            regionCodes: .init(stateProvince: "US-WA", countryCode: "US"),
            timeZone: "America/Los_Angeles"
        )))

        let commitDone = await waitUntil { !model.isLocatingCurrentLocation }
        XCTAssertTrue(commitDone)
        XCTAssertTrue(committed)

        XCTAssertEqual(model.acceptedSelection.name, "Ballard Locks")
        XCTAssertEqual(model.acceptedSelection.coordinate?.latitude, fixCoord.latitude)
        XCTAssertEqual(model.acceptedSelection.coordinate?.longitude, fixCoord.longitude)
        XCTAssertEqual(model.acceptedSelection.source, .currentLocation)
        XCTAssertTrue(model.acceptedSelection.overridesPhotoGPS)
        XCTAssertEqual(model.acceptedSelection.stateProvince, "US-WA")
        XCTAssertEqual(model.acceptedSelection.countryCode, "US")
        XCTAssertEqual(model.acceptedSelection.timeZone?.identifier, "America/Los_Angeles")
    }

    func testCurrentLocationCancelledWithLateNoncooperativeResponseLeavesSelectionUnchanged() async {
        let mockGeocoding = MockGeocodingLookup()
        mockGeocoding.shouldSuspend = true

        let mockLocation = MockCurrentLocationRequester()
        mockLocation.resultCoordinate = CLLocationCoordinate2D(latitude: 47.7115, longitude: -122.3717)

        let model = OutingLocationReviewModel(
            geocodingLookup: mockGeocoding,
            currentLocationRequester: mockLocation
        )
        let cluster = makeCluster(lat: nil, lon: nil)
        model.configure(for: cluster, useGeoContext: false)

        var committed = false
        model.requestCurrentLocation(onCommit: { committed = true })

        // Wait until location fix arrives and reverse lookup is suspended
        let reverseStarted = await waitUntil { mockGeocoding.reverseCalls.count == 1 }
        XCTAssertTrue(reverseStarted)
        XCTAssertNil(model.acceptedSelection.coordinate)

        // Cancel while suspended
        model.cancelAllWork()
        XCTAssertFalse(model.isLocatingCurrentLocation)

        // Late noncooperative response arrives from reverse geocoding
        let lateResult = GeocodingResult(
            label: "Late Arrival Park", context: nil,
            latitude: 47.7115, longitude: -122.3717,
            stateProvince: "US-WA", countryCode: "US"
        )
        mockGeocoding.resumePending(with: .success((
            result: lateResult,
            nearby: [lateResult],
            regionCodes: nil,
            timeZone: nil
        )))

        await Task.yield()

        // Selection must remain unchanged and onCommit must not fire
        XCTAssertFalse(committed)
        XCTAssertNil(model.acceptedSelection.coordinate)
        XCTAssertEqual(model.acceptedSelection.name, "")
    }

    func testCurrentLocationFailureSetsError() async {
        let mockGeocoding = MockGeocodingLookup()
        let mockLocation = MockCurrentLocationRequester()
        mockLocation.requestError = CurrentLocationError.denied

        let model = OutingLocationReviewModel(
            geocodingLookup: mockGeocoding,
            currentLocationRequester: mockLocation
        )
        let cluster = makeCluster(lat: nil, lon: nil)
        model.configure(for: cluster, useGeoContext: false)

        model.requestCurrentLocation()
        let finished = await waitUntil { !model.isLocatingCurrentLocation }
        XCTAssertTrue(finished)

        XCTAssertNil(model.acceptedSelection.coordinate)
        XCTAssertEqual(model.currentLocationError, CurrentLocationError.denied.errorDescription)
    }

    func testCancelAllWorkStopsCurrentLocationAndReverseLookup() async {
        let mockGeocoding = MockGeocodingLookup()
        mockGeocoding.shouldSuspend = true

        let mockLocation = MockCurrentLocationRequester()
        mockLocation.shouldSuspend = true

        let model = OutingLocationReviewModel(
            geocodingLookup: mockGeocoding,
            currentLocationRequester: mockLocation
        )
        let cluster = makeCluster(lat: nil, lon: nil)
        model.configure(for: cluster, useGeoContext: false)

        model.requestCurrentLocation()
        XCTAssertTrue(model.isLocatingCurrentLocation)

        let cancelsBefore = mockLocation.cancelCalls
        model.cancelAllWork()
        XCTAssertFalse(model.isLocatingCurrentLocation)
        XCTAssertEqual(mockLocation.cancelCalls - cancelsBefore, 1)

        XCTAssertNil(model.acceptedSelection.coordinate)
    }

    // MARK: - Map and Status Display Interface

    func testValidCoordinateReturnsExactCoordinateOnlyWhenValid() {
        let mockGeocoding = MockGeocodingLookup()
        let model = OutingLocationReviewModel(geocodingLookup: mockGeocoding)

        let exactLat = 47.71151234
        let exactLon = -122.37174567
        let cluster = makeCluster(lat: exactLat, lon: exactLon)
        model.configure(for: cluster, useGeoContext: false)

        XCTAssertNotNil(model.validCoordinate)
        XCTAssertEqual(model.validCoordinate?.latitude, exactLat)
        XCTAssertEqual(model.validCoordinate?.longitude, exactLon)

        let emptyCluster = makeCluster(lat: nil, lon: nil)
        model.configure(for: emptyCluster, useGeoContext: false)
        XCTAssertNil(model.validCoordinate)
    }

    func testSourceStatusSummaryCoversDistinctProvenanceAndProgressStates() {
        let mockGeocoding = MockGeocodingLookup()
        let model = OutingLocationReviewModel(geocodingLookup: mockGeocoding)

        let emptyCluster = makeCluster(lat: nil, lon: nil)
        model.configure(for: emptyCluster, useGeoContext: false)
        XCTAssertEqual(model.sourceStatusSummary, "No GPS data in photos")

        let cluster = makeCluster(lat: 47.7115, lon: -122.3717)
        model.configure(for: cluster, useGeoContext: false)
        XCTAssertEqual(model.sourceStatusSummary, "GPS detected")

        let place = GeocodingResult(
            label: "Discovery Park", context: nil, latitude: 47.6, longitude: -122.4,
            stateProvince: "US-WA", countryCode: "US"
        )
        model.commitPlaceSearchSelection(place)
        XCTAssertEqual(model.sourceStatusSummary, "Location set from search")

        let mockLocation = MockCurrentLocationRequester()
        mockLocation.resultCoordinate = CLLocationCoordinate2D(latitude: 47.7, longitude: -122.3)
        let locatingModel = OutingLocationReviewModel(
            geocodingLookup: mockGeocoding,
            currentLocationRequester: mockLocation
        )
        locatingModel.configure(for: emptyCluster, useGeoContext: false)
        locatingModel.requestCurrentLocation()
        XCTAssertEqual(locatingModel.sourceStatusSummary, "Getting current location...")
    }
}
