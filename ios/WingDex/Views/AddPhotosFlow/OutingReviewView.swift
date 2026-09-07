import CoreLocation
import SwiftUI

enum OutingReviewDestination: String, Identifiable {
    case search
    case map
    case photos

    var id: String { rawValue }
}

struct OutingReviewView: View {
    @Bindable var viewModel: AddPhotosViewModel
    @Bindable var locationModel: OutingLocationReviewModel
    @Bindable var searchModel: OutingLocationSearchModel
    @Binding var destination: OutingReviewDestination?
    @Environment(DataStore.self) private var store

    @State private var matchingOuting: Outing?
    @State private var useExistingOuting = false
    @State private var overriddenStartTime: Date?
    @State private var needsInitialLookup = false
    @State private var selectedPhotoID = ""

    private var cluster: PhotoCluster? {
        guard viewModel.clusters.indices.contains(viewModel.currentClusterIndex) else { return nil }
        return viewModel.clusters[viewModel.currentClusterIndex]
    }

    private var effectiveTimeZone: TimeZone {
        if useExistingOuting, let existing = matchingOuting,
           let timeZone = DateFormatting.storedTimeZone(existing.startTime) {
            return timeZone
        }
        return locationModel.acceptedSelection.timeZone ?? locationModel.fallbackTimeZone
    }

    private var mapLocation: OutingMapLocation? {
        if useExistingOuting, let existing = matchingOuting {
            let coordinate: CLLocationCoordinate2D? = if let lat = existing.lat, let lon = existing.lon {
                CLLocationCoordinate2D(latitude: lat, longitude: lon)
            } else {
                nil
            }
            return OutingMapLocation(
                name: existing.locationName, coordinate: coordinate,
                sourceDescription: "From existing outing"
            )
        }
        return OutingMapLocation(
            name: locationModel.acceptedSelection.name,
            coordinate: locationModel.validCoordinate,
            sourceDescription: locationModel.sourceStatusSummary
        )
    }

    var body: some View {
        Form {
            Section {
                DatePicker(
                    "Date & Time",
                    selection: Binding(
                        get: { overriddenStartTime ?? cluster?.startTime ?? Date() },
                        set: { overriddenStartTime = $0 }
                    ),
                    displayedComponents: [.date, .hourAndMinute]
                )
                .foregroundStyle(.primary)
                .tint(.primary)
                .environment(\.timeZone, effectiveTimeZone)

                gpsStatusSection
                    .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
            }

            if let existing = matchingOuting {
                Section {
                    Toggle(isOn: $useExistingOuting) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Add to existing outing?")
                            Text("\(existing.locationName) - \(DateFormatting.formatDate(existing.startTime))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .accessibilityIdentifier("outing.useExisting")
                }
            }

            Section {
                if let mapLocation {
                    OutingLocationMapPreview(location: mapLocation) {
                        locationModel.cancelAllWork()
                        destination = .map
                    }
                    .listRowInsets(EdgeInsets())
                    .listRowSeparator(.hidden)
                }
                locationBar
                    .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                    .listRowSeparator(.hidden)
            } header: {
                Text("Location")
                    .accessibilityIdentifier("outing.locationHeader")
            } footer: {
                Text("Powered by [Geoapify](https://www.geoapify.com/) and [OpenStreetMap](https://www.openstreetmap.org/copyright)")
                    .accessibilityIdentifier("outing.locationAttribution")
            }

            Section {
                PhotoReviewCarousel(photos: cluster?.photos ?? [], onOpen: { photo in
                    selectedPhotoID = photo.id
                    destination = .photos
                }, onRemove: removePhoto)
                    .frame(height: 150)
            } header: {
                Text("Photos (\(cluster?.photos.count ?? 0))")
                    .accessibilityIdentifier("outing.photosHeader")
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background(Color.pageBg.ignoresSafeArea())
        .navigationTitle(viewModel.clusters.count > 1
            ? "Outing \(viewModel.currentClusterIndex + 1) of \(viewModel.clusters.count)"
            : "Your Outing")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if destination == nil {
                ToolbarItem(placement: .primaryAction) {
                    Button(action: handleConfirm) {
                        Image(systemName: "chevron.right")
                    }
                    .accessibilityLabel("Continue")
                    .buttonStyle(.borderedProminent)
                    .accessibilityShowsLargeContentViewer()
                    .accessibilityIdentifier("outing.continue")
                    .disabled(!useExistingOuting && locationModel.isLoadingLocation)
                }
            }
        }
        .sheet(item: $destination) { route in
            NavigationStack {
                switch route {
                case .search:
                    OutingLocationSearchView(reviewModel: locationModel, searchModel: searchModel) {
                        applySelectedTimeZone()
                    }
                case .map:
                    if let mapLocation {
                        OutingLocationMapView(location: mapLocation)
                    }
                case .photos:
                    PhotoReviewSheet(photos: cluster?.photos ?? [], selectedPhotoID: selectedPhotoID)
                }
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
            .onDisappear {
                if route != .photos {
                    searchModel.endEditing()
                    locationModel.cancelAllWork()
                }
            }
        }
        .onAppear { initializeCluster() }
        .onChange(of: cluster?.id) { initializeCluster() }
        .onChange(of: locationModel.acceptedSelection.timeZone) {
            applySelectedTimeZone()
        }
        .onChange(of: useExistingOuting) { _, usesExisting in
            if usesExisting {
                needsInitialLookup = needsInitialLookup || locationModel.isLoadingLocation
                locationModel.cancelAllWork()
            } else {
                applySelectedTimeZone()
                if needsInitialLookup && viewModel.useGeoContext {
                    needsInitialLookup = false
                    locationModel.retryReverseGeocoding()
                }
            }
        }
    }

    private var locationBar: some View {
        HStack(spacing: 0) {
            if useExistingOuting, let existing = matchingOuting {
                Text(existing.locationName)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .accessibilityValue("From existing outing")
                    .accessibilityIdentifier("outing.inheritedLocationName")
            } else {
                Button {
                    locationModel.cancelAllWork()
                    destination = .search
                } label: {
                    HStack(spacing: 12) {
                        Text(locationName)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text("Edit")
                            .foregroundStyle(.tint)
                            .fixedSize()
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .ignore)
                .accessibilityAddTraits(.isButton)
                .accessibilityLabel(locationName)
                .accessibilityValue(locationStatusDescription)
                .accessibilityHint("Edit location")
                .accessibilityIdentifier("outing.adjustLocation")
            }
        }
    }

    private var locationName: String {
        locationModel.acceptedSelection.name.isEmpty ? "No location" : locationModel.acceptedSelection.name
    }

    private var locationStatusDescription: String {
        if useExistingOuting { return "From existing outing" }
        return switch locationModel.lookupState {
        case .error: "\(locationModel.sourceStatusSummary). Location lookup failed. Retry available."
        case .paused: "\(locationModel.sourceStatusSummary). Location lookup paused. Retry available."
        case .empty: "\(locationModel.sourceStatusSummary). No named place found nearby."
        case .ok: locationModel.sourceStatusSummary
        }
    }

    private var gpsSourceLabel: String {
        switch locationModel.acceptedSelection.source {
        case .currentLocation: "Current location"
        case .placeSearch: "Location set from search"
        case .photoGPS, .manual: "GPS detected"
        }
    }

    private var gpsStatusSection: some View {
        HStack {
            if let coordinate = locationModel.validCoordinate {
                Label {
                    HStack(spacing: 4) {
                        Text(gpsSourceLabel)
                            .accessibilityIdentifier("outing.gpsStatus")
                        Text("(\(coordinate.latitude, specifier: "%.4f"), \(coordinate.longitude, specifier: "%.4f"))")
                            .foregroundStyle(Color.foregroundText)
                            .accessibilityIdentifier("outing.gpsCoordinates")
                    }
                } icon: {
                    Image(systemName: "location.fill")
                        .foregroundStyle(.green)
                }
                .font(.subheadline)
            } else {
                Label("No GPS data in photos", systemImage: "location.slash")
                    .font(.subheadline)
                    .foregroundStyle(.orange)
                    .accessibilityIdentifier("outing.gpsStatus")
            }
            Spacer(minLength: 0)
            locationLookupControl
        }
        .frame(minHeight: 44)
    }

    @ViewBuilder
    private var locationLookupControl: some View {
        if !useExistingOuting && locationModel.isLoadingLocation {
            Button(action: locationModel.cancelAllWork) {
                ProgressView()
                    .controlSize(.small)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Cancel location lookup")
            .accessibilityIdentifier("outing.locationCancel")
        } else if !useExistingOuting && (locationModel.lookupState == .error || locationModel.lookupState == .paused) {
            Button(action: locationModel.retryReverseGeocoding) {
                Image(systemName: "arrow.clockwise")
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Retry location lookup")
            .accessibilityIdentifier("outing.locationRetry")
        }
    }

    private func initializeCluster(forceReset: Bool = false) {
        guard forceReset || locationModel.activeClusterID != cluster?.id else { return }
        destination = nil
        overriddenStartTime = nil
        matchingOuting = cluster.flatMap { findMatchingOuting(cluster: $0, outings: store.outings) }
        useExistingOuting = matchingOuting != nil
        needsInitialLookup = useExistingOuting
        locationModel.configure(
            for: cluster, useGeoContext: viewModel.useGeoContext && !useExistingOuting,
            forceReset: forceReset
        )
        applySelectedTimeZone()
    }

    private func applySelectedTimeZone() {
        guard !useExistingOuting else { return }
        viewModel.resolveCurrentClusterTimeZone(effectiveTimeZone)
        if let cluster {
            matchingOuting = findMatchingOuting(cluster: cluster, outings: store.outings)
        }
    }

    private func removePhoto(_ photo: ProcessedPhoto) {
        locationModel.cancelAllWork()
        searchModel.endEditing()
        Task {
            await viewModel.removePhotoFromCurrentCluster(id: photo.id)
            if viewModel.currentStep == .outingReview {
                // Removal can replace the cluster or change its GPS and time bounds.
                initializeCluster(forceReset: true)
            }
        }
    }

    private func handleConfirm() {
        locationModel.cancelAllWork()
        searchModel.endEditing()
        if useExistingOuting, let existing = matchingOuting {
            viewModel.resolveCurrentClusterTimeZone(effectiveTimeZone)
            viewModel.outingConfirmed(
                outing: nil, outingId: existing.id, locationName: existing.locationName,
                lat: existing.lat, lon: existing.lon, outingOverridesPhotoGPS: false
            )
            return
        }
        viewModel.resolveCurrentClusterTimeZone(effectiveTimeZone)
        let selection = locationModel.acceptedSelection
        let name = selection.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let finalName = name.isEmpty ? "Unknown Location" : name
        let start = overriddenStartTime ?? cluster?.startTime ?? Date()
        let duration = cluster.map { $0.endTime.timeIntervalSince($0.startTime) } ?? 0
        let outing = Outing(
            id: "outing_\(UUID().uuidString)", userId: "",
            startTime: DateFormatting.storageString(start, timeZone: effectiveTimeZone),
            endTime: DateFormatting.storageString(start.addingTimeInterval(duration), timeZone: effectiveTimeZone),
            locationName: finalName, defaultLocationName: finalName,
            lat: selection.coordinate?.latitude, lon: selection.coordinate?.longitude,
            stateProvince: selection.stateProvince, countryCode: selection.countryCode,
            notes: "", createdAt: ISO8601DateFormatter().string(from: Date())
        )
        viewModel.outingConfirmed(
            outing: outing, outingId: outing.id, locationName: finalName,
            lat: outing.lat, lon: outing.lon, outingOverridesPhotoGPS: selection.overridesPhotoGPS
        )
    }

    private func findMatchingOuting(cluster: PhotoCluster, outings: [Outing]) -> Outing? {
        let timeThreshold: TimeInterval = 2 * 60 * 60
        let tightTimeThreshold: TimeInterval = 30 * 60
        let maxDistanceKm = 3.0
        let relaxedDistanceKm = 50.0

        for outing in outings {
            let outingStart = DateFormatting.sortDate(outing.startTime).timeIntervalSince1970
            let outingEnd = DateFormatting.sortDate(outing.endTime).timeIntervalSince1970
            let clusterStart = cluster.startTime.timeIntervalSince1970
            let clusterEnd = cluster.endTime.timeIntervalSince1970
            let timeOverlap = clusterStart <= outingEnd + timeThreshold
                && clusterEnd >= outingStart - timeThreshold
            guard timeOverlap else { continue }
            if let cLat = cluster.centerLat, let cLon = cluster.centerLon,
               let oLat = outing.lat, let oLon = outing.lon {
                let dist = PhotoService.haversineDistance(lat1: cLat, lon1: cLon, lat2: oLat, lon2: oLon)
                let clusterMid = (clusterStart + clusterEnd) / 2
                let outingMid = (outingStart + outingEnd) / 2
                let timeDelta = abs(clusterMid - outingMid)
                let threshold = timeDelta <= tightTimeThreshold ? relaxedDistanceKm : maxDistanceKm
                if dist > threshold { continue }
            }
            return outing
        }
        return nil
    }
}

#if DEBUG
private struct ReviewPreview: View {
    @State private var destination: OutingReviewDestination?
    @State private var vm = AddPhotosViewModel()
    @State private var location = OutingLocationReviewModel(geocodingLookup: ReviewPreviewGeocoder())
    @State private var search = OutingLocationSearchModel(placeSearcher: ReviewPreviewGeocoder())
    let hasGPS: Bool
    var existing = false

    var body: some View {
        NavigationStack {
            OutingReviewView(
                viewModel: vm, locationModel: location, searchModel: search, destination: $destination
            )
            .environment(previewStore(empty: !existing))
            .onAppear {
                var cluster = PreviewData.sampleCluster(
                    photoCount: 3, lat: hasGPS ? 47.6587 : nil, lon: hasGPS ? -122.4050 : nil
                )
                if existing {
                    cluster.startTime = DateFormatting.sortDate(PreviewData.outings[0].startTime)
                    cluster.endTime = DateFormatting.sortDate(PreviewData.outings[0].endTime)
                }
                vm.clusters = [cluster]
            }
        }
    }
}

private struct ReviewPreviewGeocoder: LocationReverseGeocodingLookup, PlaceSearching {
    func search(query: String) async throws -> [GeocodingResult] {
        let response = try await reverse(latitude: 47.6587, longitude: -122.4050)
        return response.nearby
    }

    func reverse(latitude: Double, longitude: Double) async throws -> (
        result: GeocodingResult?, nearby: [GeocodingResult],
        regionCodes: GeocodingService.RegionCodes?, timeZone: String?
    ) {
        let place = GeocodingResult(
            label: "Discovery Park", context: "Seattle, Washington", latitude: latitude, longitude: longitude,
            stateProvince: "US-WA", countryCode: "US"
        )
        return (place, [place], .init(stateProvince: "US-WA", countryCode: "US"), "America/Los_Angeles")
    }
}

#Preview("With GPS") { ReviewPreview(hasGPS: true) }
#Preview("No GPS") { ReviewPreview(hasGPS: false) }
#Preview("Existing Outing Match") { ReviewPreview(hasGPS: true, existing: true) }
#endif
