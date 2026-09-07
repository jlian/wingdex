import CoreLocation
import Foundation
import Observation
import os

private let log = Logger(subsystem: Config.bundleID, category: "OutingLocationReview")

// MARK: - Protocols for Injectable Async Boundaries

@MainActor
protocol LocationReverseGeocodingLookup: Sendable {
    func reverse(
        latitude: Double,
        longitude: Double
    ) async throws -> (result: GeocodingResult?, nearby: [GeocodingResult], regionCodes: GeocodingService.RegionCodes?, timeZone: String?)
}

@MainActor
protocol CurrentLocationRequesting: Sendable {
    func request() async throws -> CLLocationCoordinate2D
    func cancel()
}

extension GeocodingService: LocationReverseGeocodingLookup {}
extension CurrentLocationService: CurrentLocationRequesting {}

/// Default adapter for current location requests supporting debug UI test flags.
@MainActor
struct DefaultCurrentLocationRequester: CurrentLocationRequesting {
    private let service: CurrentLocationService

    init(service: CurrentLocationService = CurrentLocationService()) {
        self.service = service
    }

    func request() async throws -> CLLocationCoordinate2D {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if args.contains("--ui-test-current-location-denied") {
            throw CurrentLocationError.denied
        }
        if args.contains("--ui-test-current-location-success") {
            if args.contains("--ui-test-current-location-delay") {
                try await Task.sleep(for: .seconds(10))
            }
            return CLLocationCoordinate2D(latitude: 47.7115123, longitude: -122.3717456)
        }
        #endif
        return try await service.request()
    }

    func cancel() {
        service.cancel()
    }
}

// MARK: - Models and Selection Types

enum OutingLocationSource: String, Sendable, Equatable {
    case photoGPS
    case currentLocation
    case placeSearch
    case manual
}

enum LocationLookupState: Equatable, Sendable {
    case ok
    case empty
    case error
    case paused
}

struct OutingLocationSelection: Equatable, Sendable {
    var name: String
    var coordinate: CLLocationCoordinate2D?
    var source: OutingLocationSource
    var stateProvince: String?
    var countryCode: String?
    var timeZone: TimeZone?
    var overridesPhotoGPS: Bool

    static func == (lhs: OutingLocationSelection, rhs: OutingLocationSelection) -> Bool {
        guard lhs.name == rhs.name,
              lhs.source == rhs.source,
              lhs.stateProvince == rhs.stateProvince,
              lhs.countryCode == rhs.countryCode,
              lhs.timeZone == rhs.timeZone,
              lhs.overridesPhotoGPS == rhs.overridesPhotoGPS else {
            return false
        }
        switch (lhs.coordinate, rhs.coordinate) {
        case (nil, nil):
            return true
        case let (c1?, c2?):
            return c1.latitude == c2.latitude && c1.longitude == c2.longitude
        default:
            return false
        }
    }
}

struct OutingLocationSourceSuggestion: Equatable, Sendable {
    var name: String
    var coordinate: CLLocationCoordinate2D
    var source: OutingLocationSource
    var stateProvince: String?
    var countryCode: String?
    var timeZone: TimeZone?
    var nearbyPlaces: [GeocodingResult]

    static func == (lhs: OutingLocationSourceSuggestion, rhs: OutingLocationSourceSuggestion) -> Bool {
        lhs.name == rhs.name &&
        lhs.coordinate.latitude == rhs.coordinate.latitude &&
        lhs.coordinate.longitude == rhs.coordinate.longitude &&
        lhs.source == rhs.source &&
        lhs.stateProvince == rhs.stateProvince &&
        lhs.countryCode == rhs.countryCode &&
        lhs.timeZone == rhs.timeZone &&
        lhs.nearbyPlaces.map(\.id) == rhs.nearbyPlaces.map(\.id)
    }
}

// MARK: - OutingLocationReviewModel

@MainActor
@Observable
final class OutingLocationReviewModel {
    private(set) var acceptedSelection: OutingLocationSelection
    private(set) var sourceSuggestion: OutingLocationSourceSuggestion?
    private(set) var lookupState: LocationLookupState = .ok
    private(set) var isLoadingLocation = false
    private(set) var isLocatingCurrentLocation = false
    private(set) var currentLocationError: String?
    private(set) var activeClusterID: UUID?
    private(set) var fallbackTimeZone: TimeZone

    var validCoordinate: CLLocationCoordinate2D? {
        guard let coord = acceptedSelection.coordinate,
              CLLocationCoordinate2DIsValid(coord) else {
            return nil
        }
        return coord
    }

    var sourceStatusSummary: String {
        if isLocatingCurrentLocation {
            return "Getting current location..."
        }
        if isLoadingLocation {
            return acceptedSelection.source == .currentLocation
                ? "Identifying current location..."
                : "Identifying location from GPS..."
        }
        switch acceptedSelection.source {
        case .photoGPS:
            return "GPS detected"
        case .currentLocation:
            return "Current location"
        case .placeSearch:
            return "Location set from search"
        case .manual:
            return acceptedSelection.coordinate != nil ? "GPS detected" : "No GPS data in photos"
        }
    }

    var canRequestCurrentLocation: Bool {
        acceptedSelection.coordinate == nil && !isLocatingCurrentLocation
    }

    private let geocodingLookup: LocationReverseGeocodingLookup
    private let currentLocationRequester: CurrentLocationRequesting
    private let onReverseGeocodingCancellationAcknowledged: () -> Void

    private var reverseGeocodeGeneration = 0
    private var reverseGeocodeTask: Task<Void, Never>?
    private var sourceLookupState: LocationLookupState = .ok

    private var currentLocationGeneration = 0
    private var currentLocationTask: Task<Void, Never>?

    init(
        geocodingLookup: LocationReverseGeocodingLookup,
        currentLocationRequester: CurrentLocationRequesting = DefaultCurrentLocationRequester(),
        fallbackTimeZone: TimeZone = .current,
        onReverseGeocodingCancellationAcknowledged: @escaping () -> Void = {}
    ) {
        self.geocodingLookup = geocodingLookup
        self.currentLocationRequester = currentLocationRequester
        self.fallbackTimeZone = fallbackTimeZone
        self.onReverseGeocodingCancellationAcknowledged = onReverseGeocodingCancellationAcknowledged
        self.acceptedSelection = OutingLocationSelection(
            name: "",
            coordinate: nil,
            source: .manual,
            stateProvince: nil,
            countryCode: nil,
            timeZone: nil,
            overridesPhotoGPS: false
        )
    }

    // MARK: - Lifecycle

    func configure(
        for cluster: PhotoCluster?,
        useGeoContext: Bool,
        fallbackTimeZone: TimeZone? = nil,
        forceReset: Bool = false
    ) {
        let newClusterID = cluster?.id
        if !forceReset, activeClusterID == newClusterID && activeClusterID != nil {
            return
        }

        cancelAllWork()
        activeClusterID = newClusterID
        lookupState = .ok
        sourceLookupState = .ok
        currentLocationError = nil
        self.fallbackTimeZone = fallbackTimeZone
            ?? cluster?.photos.compactMap(\.captureTime).first?.timeZone
            ?? .current

        guard let cluster else {
            resetToEmpty()
            return
        }

        if let lat = cluster.centerLat, let lon = cluster.centerLon,
           CLLocationCoordinate2DIsValid(CLLocationCoordinate2D(latitude: lat, longitude: lon)) {
            let coord = CLLocationCoordinate2D(latitude: lat, longitude: lon)
            let fallbackName = Self.coordinateFallbackName(latitude: lat, longitude: lon)

            self.acceptedSelection = OutingLocationSelection(
                name: fallbackName,
                coordinate: coord,
                source: .photoGPS,
                stateProvince: nil,
                countryCode: nil,
                timeZone: nil,
                overridesPhotoGPS: false
            )

            self.sourceSuggestion = OutingLocationSourceSuggestion(
                name: fallbackName,
                coordinate: coord,
                source: .photoGPS,
                stateProvince: nil,
                countryCode: nil,
                timeZone: nil,
                nearbyPlaces: []
            )

            if useGeoContext {
                startReverseGeocode(coordinate: coord, source: .photoGPS)
            }
        } else {
            resetToEmpty()
        }
    }

    func resetClusterState() {
        cancelAllWork()
        resetToEmpty()
        activeClusterID = nil
    }

    private func resetToEmpty() {
        acceptedSelection = OutingLocationSelection(
            name: "",
            coordinate: nil,
            source: .manual,
            stateProvince: nil,
            countryCode: nil,
            timeZone: nil,
            overridesPhotoGPS: false
        )
        sourceSuggestion = nil
        lookupState = .ok
        sourceLookupState = .ok
        currentLocationError = nil
    }

    func cancelAllWork() {
        if isLoadingLocation {
            lookupState = .paused
            sourceLookupState = .paused
        }
        reverseGeocodeGeneration += 1
        reverseGeocodeTask?.cancel()
        reverseGeocodeTask = nil
        isLoadingLocation = false

        currentLocationGeneration += 1
        currentLocationTask?.cancel()
        currentLocationTask = nil
        currentLocationRequester.cancel()
        isLocatingCurrentLocation = false
    }

    // MARK: - Commit Transitions

    @discardableResult
    func commitPlaceSearchSelection(_ result: GeocodingResult) -> Bool {
        let coord = CLLocationCoordinate2D(latitude: result.latitude, longitude: result.longitude)
        guard CLLocationCoordinate2DIsValid(coord) else {
            currentLocationError = "Invalid coordinates for selected location."
            return false
        }

        cancelAllWork()
        lookupState = .ok
        currentLocationError = nil
        let tz = result.timeZone.flatMap(TimeZone.init(identifier:))

        acceptedSelection = OutingLocationSelection(
            name: result.label,
            coordinate: coord,
            source: .placeSearch,
            stateProvince: result.stateProvince,
            countryCode: result.countryCode,
            timeZone: tz,
            overridesPhotoGPS: true
        )
        return true
    }

    func commitNearbySelection(_ result: GeocodingResult) {
        cancelAllWork()
        lookupState = .ok
        currentLocationError = nil

        let coord = sourceSuggestion?.coordinate ?? acceptedSelection.coordinate
        let source = sourceSuggestion?.source ?? acceptedSelection.source
        let overrides = (source == .currentLocation)

        acceptedSelection = OutingLocationSelection(
            name: result.label,
            coordinate: coord,
            source: source,
            stateProvince: result.stateProvince ?? sourceSuggestion?.stateProvince,
            countryCode: result.countryCode ?? sourceSuggestion?.countryCode,
            timeZone: sourceSuggestion?.timeZone ?? acceptedSelection.timeZone,
            overridesPhotoGPS: overrides
        )
    }

    func commitManualName(_ name: String) {
        cancelAllWork()
        lookupState = .ok
        currentLocationError = nil
        acceptedSelection.name = name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func restoreSourceSuggestion() {
        guard let suggestion = sourceSuggestion else { return }
        cancelAllWork()
        lookupState = sourceLookupState
        currentLocationError = nil

        let overrides = (suggestion.source == .currentLocation)
        acceptedSelection = OutingLocationSelection(
            name: suggestion.name,
            coordinate: suggestion.coordinate,
            source: suggestion.source,
            stateProvince: suggestion.stateProvince,
            countryCode: suggestion.countryCode,
            timeZone: suggestion.timeZone,
            overridesPhotoGPS: overrides
        )
    }

    // MARK: - Current Location

    func requestCurrentLocation(onCommit: @escaping () -> Void = {}) {
        guard canRequestCurrentLocation else { return }
        cancelAllWork()
        currentLocationError = nil
        isLocatingCurrentLocation = true

        let generation = currentLocationGeneration
        let clusterID = activeClusterID

        currentLocationTask = Task { [weak self] in
            defer {
                if let self, self.currentLocationGeneration == generation {
                    self.isLocatingCurrentLocation = false
                    self.currentLocationTask = nil
                }
            }

            do {
                guard let self else { return }
                let coordinate = try await self.currentLocationRequester.request()
                try Task.checkCancellation()

                guard self.currentLocationGeneration == generation,
                      self.activeClusterID == clusterID else { return }

                guard CLLocationCoordinate2DIsValid(coordinate) else {
                    throw CurrentLocationError.unavailable
                }

                await self.resolveAndCommitCurrentLocation(
                    coordinate: coordinate,
                    generation: generation,
                    clusterID: clusterID,
                    onCommit: onCommit
                )
            } catch is CancellationError {
                return
            } catch {
                guard let self, self.currentLocationGeneration == generation,
                      self.activeClusterID == clusterID, !Task.isCancelled else { return }
                self.currentLocationError = error.localizedDescription
            }
        }
    }

    private func resolveAndCommitCurrentLocation(
        coordinate: CLLocationCoordinate2D,
        generation: Int,
        clusterID: UUID?,
        onCommit: () -> Void
    ) async {
        let fallbackName = Self.coordinateFallbackName(latitude: coordinate.latitude, longitude: coordinate.longitude)
        var resolvedName = fallbackName
        var resolvedState: String?
        var resolvedCountry: String?
        var resolvedTimeZone: TimeZone?
        var nearby: [GeocodingResult] = []
        var lookupStateOutcome: LocationLookupState = .ok

        do {
            let lookup = try await performReverseLookup(
                latitude: coordinate.latitude,
                longitude: coordinate.longitude
            )
            try Task.checkCancellation()

            if let result = lookup.result {
                resolvedName = result.label
                resolvedState = result.stateProvince
                resolvedCountry = result.countryCode
                resolvedTimeZone = lookup.timeZone.flatMap(TimeZone.init(identifier:))
                nearby = lookup.nearby
                lookupStateOutcome = .ok
            } else {
                resolvedState = lookup.regionCodes?.stateProvince
                resolvedCountry = lookup.regionCodes?.countryCode
                resolvedTimeZone = lookup.timeZone.flatMap(TimeZone.init(identifier:))
                lookupStateOutcome = .empty
            }
        } catch is CancellationError {
            return
        } catch {
            log.error("Reverse lookup for current location failed: \(error.localizedDescription, privacy: .public)")
            lookupStateOutcome = .error
        }

        guard currentLocationGeneration == generation,
              activeClusterID == clusterID,
              !Task.isCancelled else { return }

        self.lookupState = lookupStateOutcome
        self.sourceLookupState = lookupStateOutcome
        self.acceptedSelection = OutingLocationSelection(
            name: resolvedName,
            coordinate: coordinate,
            source: .currentLocation,
            stateProvince: resolvedState,
            countryCode: resolvedCountry,
            timeZone: resolvedTimeZone,
            overridesPhotoGPS: true
        )

        self.sourceSuggestion = OutingLocationSourceSuggestion(
            name: resolvedName,
            coordinate: coordinate,
            source: .currentLocation,
            stateProvince: resolvedState,
            countryCode: resolvedCountry,
            timeZone: resolvedTimeZone,
            nearbyPlaces: nearby
        )

        onCommit()
    }

    // MARK: - Reverse Geocoding

    func retryReverseGeocoding() {
        restoreSourceSuggestion()
        guard let suggestion = sourceSuggestion else { return }
        startReverseGeocode(coordinate: suggestion.coordinate, source: suggestion.source)
    }

    private func performReverseLookup(
        latitude: Double,
        longitude: Double
    ) async throws -> (result: GeocodingResult?, nearby: [GeocodingResult], regionCodes: GeocodingService.RegionCodes?, timeZone: String?) {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if args.contains("--ui-test-geocoding-delay") {
            do {
                try await Task.sleep(for: .seconds(10))
            } catch is CancellationError {
                onReverseGeocodingCancellationAcknowledged()
                throw CancellationError()
            }
        }
        if args.contains("--ui-test-geocoding-failure") {
            throw GeocodingServiceError.server(statusCode: 500, traceID: "ui-test-failure")
        }
        if args.contains("--ui-test-geocoding-empty") {
            return (
                result: nil,
                nearby: [],
                regionCodes: .init(stateProvince: "US-WA", countryCode: "US"),
                timeZone: nil
            )
        }
        if args.contains("--ui-test-geocoding-success") {
            let result = GeocodingResult(
                label: "Carkeek Park",
                context: "Seattle, Washington",
                latitude: 47.712,
                longitude: -122.372,
                stateProvince: "US-WA",
                countryCode: "US"
            )
            let nearby = GeocodingResult(
                label: "Carkeek Park Beach", context: "Seattle, Washington",
                latitude: 47.710, longitude: -122.380, stateProvince: "US-WA", countryCode: "US"
            )
            return (result: result, nearby: [result, nearby], regionCodes: .init(stateProvince: "US-WA", countryCode: "US"), timeZone: nil)
        }
        #endif

        return try await geocodingLookup.reverse(latitude: latitude, longitude: longitude)
    }

    private func startReverseGeocode(coordinate: CLLocationCoordinate2D, source: OutingLocationSource) {
        reverseGeocodeGeneration += 1
        reverseGeocodeTask?.cancel()
        reverseGeocodeTask = nil

        let generation = reverseGeocodeGeneration
        let clusterID = activeClusterID
        isLoadingLocation = true
        lookupState = .ok

        reverseGeocodeTask = Task { [weak self] in
            defer {
                if let self, self.reverseGeocodeGeneration == generation,
                   self.activeClusterID == clusterID {
                    self.isLoadingLocation = false
                    self.reverseGeocodeTask = nil
                }
            }

            do {
                guard let self else { return }
                let lookup = try await self.performReverseLookup(
                    latitude: coordinate.latitude,
                    longitude: coordinate.longitude
                )
                try Task.checkCancellation()

                guard self.reverseGeocodeGeneration == generation,
                      self.activeClusterID == clusterID else { return }

                if let result = lookup.result {
                    self.applyLookupSuccess(
                        result: result,
                        nearby: lookup.nearby,
                        timeZoneString: lookup.timeZone
                    )
                } else {
                    self.applyLookupEmpty(
                        coordinate: coordinate,
                        regionCodes: lookup.regionCodes,
                        timeZone: lookup.timeZone.flatMap(TimeZone.init(identifier:))
                    )
                }
            } catch is CancellationError {
                return
            } catch {
                log.error("Reverse geocoding failed: \(error.localizedDescription, privacy: .public)")
                guard let self, self.reverseGeocodeGeneration == generation,
                      self.activeClusterID == clusterID, !Task.isCancelled else { return }
                self.applyLookupFailure(coordinate: coordinate)
            }
        }
    }

    private func applyLookupSuccess(
        result: GeocodingResult,
        nearby: [GeocodingResult],
        timeZoneString: String?
    ) {
        let tz = timeZoneString.flatMap(TimeZone.init(identifier:))
        lookupState = .ok
        sourceLookupState = .ok

        let currentName = acceptedSelection.name
        let isInitialDefaultName = sourceSuggestion == nil || currentName == sourceSuggestion?.name || currentName.isEmpty

        if isInitialDefaultName {
            acceptedSelection.name = result.label
            acceptedSelection.stateProvince = result.stateProvince
            acceptedSelection.countryCode = result.countryCode
            acceptedSelection.timeZone = tz
        }

        if var suggestion = sourceSuggestion {
            suggestion.name = result.label
            suggestion.stateProvince = result.stateProvince
            suggestion.countryCode = result.countryCode
            suggestion.timeZone = tz
            suggestion.nearbyPlaces = nearby
            sourceSuggestion = suggestion
        }
    }

    private func applyLookupEmpty(
        coordinate: CLLocationCoordinate2D,
        regionCodes: GeocodingService.RegionCodes?,
        timeZone: TimeZone?
    ) {
        lookupState = .empty
        sourceLookupState = .empty

        let currentName = acceptedSelection.name
        let isInitialDefaultName = sourceSuggestion == nil || currentName == sourceSuggestion?.name || currentName.isEmpty

        if isInitialDefaultName {
            acceptedSelection.stateProvince = regionCodes?.stateProvince
            acceptedSelection.countryCode = regionCodes?.countryCode
            acceptedSelection.timeZone = timeZone
        }

        if var suggestion = sourceSuggestion {
            suggestion.stateProvince = regionCodes?.stateProvince
            suggestion.countryCode = regionCodes?.countryCode
            suggestion.timeZone = timeZone
            suggestion.nearbyPlaces = []
            sourceSuggestion = suggestion
        }
    }

    private func applyLookupFailure(coordinate: CLLocationCoordinate2D) {
        lookupState = .error
        sourceLookupState = .error
    }

    static func coordinateFallbackName(latitude: Double, longitude: Double) -> String {
        let roundedLat = (latitude * 1000).rounded() / 1000
        let roundedLon = (longitude * 1000).rounded() / 1000
        return "\(roundedLat)\u{00B0}, \(roundedLon)\u{00B0}"
    }
}
