import MapKit
import SwiftUI
import os

private let log = Logger(subsystem: "app.wingdex", category: "OutingReview")

/// Outing review step in the Add Photos flow.
///
/// After photos are extracted and clustered, the user reviews each cluster
/// as a potential outing: verifying/editing the location name, date/time,
/// and deciding whether to add to an existing outing or create a new one.
///
/// Matches the web app's OutingReview.tsx component.
struct OutingReviewView: View {
    @Bindable var viewModel: AddPhotosViewModel
    @Environment(AuthService.self) private var auth
    @Environment(DataStore.self) private var store

    // MARK: - Local State

    @State private var locationName = ""
    @State private var isLoadingLocation = false
    @State private var suggestedLocation = ""

    /// Extracted ISO 3166-2 state/province code from geocoding.
    @State private var inferredStateProvince: String?
    @State private var inferredCountryCode: String?

    /// Manual date/time editing
    @State private var editingDateTime = false
    @State private var manualDate = Date()
    @State private var manualTime = Date()
    @State private var overriddenStartTime: Date?

    /// Place search via Nominatim autocomplete
    @State private var placeQuery = ""
    @State private var placeResults: [NominatimPlace] = []
    @State private var isSearchingPlace = false
    @State private var overriddenCoords: CLLocationCoordinate2D?

    /// Whether to add photos to an existing matching outing
    @State private var matchingOuting: Outing?
    @State private var useExistingOuting = false

    /// Tracks whether the view has initiated geocoding for the current cluster.
    @State private var didInitialize = false

    // MARK: - Computed

    private var cluster: PhotoCluster? {
        guard viewModel.currentClusterIndex < viewModel.clusters.count else { return nil }
        return viewModel.clusters[viewModel.currentClusterIndex]
    }

    private var hasGps: Bool {
        cluster?.centerLat != nil && cluster?.centerLon != nil
    }

    /// Effective coordinates: manual override or cluster GPS.
    private var effectiveLat: Double? {
        overriddenCoords?.latitude ?? cluster?.centerLat
    }

    private var effectiveLon: Double? {
        overriddenCoords?.longitude ?? cluster?.centerLon
    }

    /// Effective start time: manual override or cluster start.
    private var effectiveStartTime: Date {
        overriddenStartTime ?? cluster?.startTime ?? Date()
    }

    /// Effective end time: preserves the cluster's duration.
    private var effectiveEndTime: Date {
        guard let c = cluster else { return Date() }
        let duration = c.endTime.timeIntervalSince(c.startTime)
        return effectiveStartTime.addingTimeInterval(duration)
    }

    // MARK: - Body

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Cluster indicator for multi-cluster uploads
                if viewModel.clusters.count > 1 {
                    Text("Outing \(viewModel.currentClusterIndex + 1) of \(viewModel.clusters.count)")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Color.mutedText)
                }

                // Date/time display with optional edit
                dateTimeSection

                // GPS status indicator
                gpsStatusSection

                // Existing outing match toggle
                if let existing = matchingOuting {
                    existingOutingSection(existing)
                }

                // Location name and place search (only when not using existing outing)
                if !useExistingOuting {
                    locationSection
                }

                // Photo thumbnails grid
                photoGridSection

                // Continue button
                Button {
                    handleConfirm()
                } label: {
                    Text(isLoadingLocation ? "Loading..." : "Continue to Species Identification")
                        .font(.system(size: 16, weight: .medium))
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color.accentColor)
                .disabled(isLoadingLocation)
            }
            .padding()
        }
        .background(Color.pageBg.ignoresSafeArea())
        .onAppear { initializeIfNeeded() }
    }

    // MARK: - Date/Time Section

    private var dateTimeSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "calendar")
                    .foregroundStyle(Color.mutedText)
                Text(formatClusterDateTime())
                    .font(.subheadline)
                    .foregroundStyle(Color.mutedText)
                Button {
                    editingDateTime.toggle()
                } label: {
                    Image(systemName: "pencil")
                        .font(.caption)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.accentColor)
            }

            // Manual date/time editor
            if editingDateTime {
                HStack(spacing: 12) {
                    DatePicker("Date", selection: $manualDate, displayedComponents: .date)
                        .labelsHidden()
                    DatePicker("Time", selection: $manualTime, displayedComponents: .hourAndMinute)
                        .labelsHidden()
                    Button("Apply") {
                        applyManualDateTime()
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
            }
        }
    }

    // MARK: - GPS Status

    private var gpsStatusSection: some View {
        HStack(spacing: 6) {
            if hasGps {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                Text("GPS detected")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.green)
                if let lat = cluster?.centerLat, let lon = cluster?.centerLon {
                    Text("(\(lat, specifier: "%.4f"), \(lon, specifier: "%.4f"))")
                        .font(.subheadline)
                        .foregroundStyle(Color.mutedText)
                }
            } else {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.orange)
                Text("No GPS data in photos")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.orange)
            }
        }
    }

    // MARK: - Existing Outing Match

    private func existingOutingSection(_ outing: Outing) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Toggle(isOn: $useExistingOuting) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Add to existing outing?")
                        .font(.subheadline.weight(.medium))
                    Text("\(outing.locationName) - \(DateFormatting.formatDate(outing.startTime))")
                        .font(.caption)
                        .foregroundStyle(Color.mutedText)
                        .lineLimit(1)
                }
            }
            .tint(Color.accentColor)
        }
        .padding(12)
        .background(Color.accentColor.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(Color.accentColor.opacity(0.3), lineWidth: 1)
        )
    }

    // MARK: - Location Section

    private var locationSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Location Name")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Color.foregroundText)

            if isLoadingLocation {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                    Text("Identifying location from GPS...")
                        .font(.subheadline)
                        .foregroundStyle(Color.mutedText)
                }
            } else {
                TextField("e.g., Central Park, NYC", text: $locationName)
                    .textFieldStyle(.roundedBorder)

                if !suggestedLocation.isEmpty && suggestedLocation != locationName {
                    Text("Suggested: \(suggestedLocation)")
                        .font(.caption)
                        .foregroundStyle(Color.mutedText)
                }

                // Place search
                placeSearchSection
            }
        }
    }

    // MARK: - Place Search

    private var placeSearchSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                TextField("Search for a place...", text: $placeQuery)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { searchPlace() }

                Button {
                    searchPlace()
                } label: {
                    Image(systemName: "magnifyingglass")
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .disabled(isSearchingPlace || placeQuery.trimmingCharacters(in: .whitespaces).isEmpty)
            }

            if isSearchingPlace {
                HStack(spacing: 6) {
                    ProgressView()
                        .controlSize(.mini)
                    Text("Searching...")
                        .font(.caption)
                        .foregroundStyle(Color.mutedText)
                }
            }

            // Search results list
            if !placeResults.isEmpty {
                VStack(spacing: 0) {
                    ForEach(placeResults) { place in
                        Button {
                            selectPlace(place)
                        } label: {
                            Text(place.displayName)
                                .font(.caption)
                                .foregroundStyle(Color.foregroundText)
                                .lineLimit(2)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                        }
                        .buttonStyle(.plain)
                        Divider()
                    }
                }
                .background(Color.cardBg)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(Color.warmBorder, lineWidth: 1)
                )
            }

            // Override confirmation
            if overriddenCoords != nil {
                Text("Location set: \(overriddenCoords!.latitude, specifier: "%.4f"), \(overriddenCoords!.longitude, specifier: "%.4f")")
                    .font(.caption)
                    .foregroundStyle(.green)
            }
        }
    }

    // MARK: - Photo Grid

    private var photoGridSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Photos (\(cluster?.photos.count ?? 0))")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Color.foregroundText)

            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 4), spacing: 4) {
                ForEach(cluster?.photos ?? [], id: \.id) { photo in
                    if let uiImage = UIImage(data: photo.thumbnail) {
                        Image(uiImage: uiImage)
                            .resizable()
                            .scaledToFill()
                            .frame(minWidth: 0, maxWidth: .infinity)
                            .aspectRatio(1, contentMode: .fill)
                            .clipped()
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                    } else {
                        RoundedRectangle(cornerRadius: 6)
                            .fill(Color.cardBg)
                            .aspectRatio(1, contentMode: .fill)
                    }
                }
            }
        }
    }

    // MARK: - Actions

    /// Initialize location lookup and matching outing detection.
    private func initializeIfNeeded() {
        guard !didInitialize else { return }
        didInitialize = true

        // Set initial date/time from cluster
        if let c = cluster {
            manualDate = c.startTime
            manualTime = c.startTime
        }

        // Pre-fill location name from last outing default
        locationName = viewModel.lastLocationName

        // Find matching existing outing
        if let c = cluster {
            matchingOuting = findMatchingOuting(cluster: c, outings: store.outings)
            useExistingOuting = matchingOuting != nil
        }

        // Reverse geocode if GPS available and not merging into existing outing
        if viewModel.useGeoContext && hasGps && matchingOuting == nil {
            Task { await reverseGeocode() }
        }
    }

    /// Reverse geocode the cluster center coordinates via Nominatim.
    private func reverseGeocode() async {
        guard let lat = cluster?.centerLat, let lon = cluster?.centerLon else { return }
        let roundedLat = (lat * 1000).rounded() / 1000
        let roundedLon = (lon * 1000).rounded() / 1000
        isLoadingLocation = true

        do {
            // Try nearby nature place first (parks, reserves)
            if let natureName = try await fetchNearbyNaturePlace(lat: roundedLat, lon: roundedLon) {
                locationName = natureName.name
                suggestedLocation = natureName.name
                inferredStateProvince = natureName.stateProvince
                inferredCountryCode = natureName.countryCode
                isLoadingLocation = false
                return
            }

            // Fall back to reverse geocode at progressively coarser zoom
            for zoom in [15, 14, 10] {
                if let result = try await fetchReverseGeocode(lat: roundedLat, lon: roundedLon, zoom: zoom) {
                    locationName = result.name
                    suggestedLocation = result.name
                    inferredStateProvince = result.stateProvince
                    inferredCountryCode = result.countryCode
                    isLoadingLocation = false
                    return
                }
            }

            // Final fallback: coordinate string
            let fallback = viewModel.lastLocationName.isEmpty
                ? "\(roundedLat)deg, \(roundedLon)deg"
                : viewModel.lastLocationName
            locationName = fallback
            suggestedLocation = fallback
        } catch {
            log.error("Reverse geocoding failed: \(error.localizedDescription)")
            let fallback = viewModel.lastLocationName.isEmpty
                ? "\(roundedLat)deg, \(roundedLon)deg"
                : viewModel.lastLocationName
            locationName = fallback
            suggestedLocation = fallback
        }
        isLoadingLocation = false
    }

    /// Search for a nature place (park, reserve) near the given coordinates.
    private func fetchNearbyNaturePlace(lat: Double, lon: Double) async throws -> GeoResult? {
        let delta = 0.02
        let left = lon - delta
        let right = lon + delta
        let top = lat + delta
        let bottom = lat - delta

        var components = URLComponents(string: "https://nominatim.openstreetmap.org/search")!
        components.queryItems = [
            URLQueryItem(name: "format", value: "jsonv2"),
            URLQueryItem(name: "q", value: "park"),
            URLQueryItem(name: "addressdetails", value: "1"),
            URLQueryItem(name: "namedetails", value: "1"),
            URLQueryItem(name: "accept-language", value: "en"),
            URLQueryItem(name: "bounded", value: "1"),
            URLQueryItem(name: "limit", value: "5"),
            URLQueryItem(name: "viewbox", value: "\(left),\(top),\(right),\(bottom)"),
        ]

        guard let url = components.url else { return nil }
        var request = URLRequest(url: url)
        request.setValue("WingDex-iOS/1.0", forHTTPHeaderField: "User-Agent")

        let (data, _) = try await URLSession.shared.data(for: request)
        let results = try JSONDecoder().decode([NominatimResult].self, from: data)

        // Score results and pick the best nature place
        let best = results
            .map { (result: $0, score: scoreNominatimResult($0)) }
            .filter { $0.score >= 60 }
            .max(by: { $0.score < $1.score })

        guard let winner = best?.result else { return nil }
        return formatGeoResult(winner)
    }

    /// Reverse geocode a point via Nominatim at the given zoom level.
    private func fetchReverseGeocode(lat: Double, lon: Double, zoom: Int) async throws -> GeoResult? {
        var components = URLComponents(string: "https://nominatim.openstreetmap.org/reverse")!
        components.queryItems = [
            URLQueryItem(name: "lat", value: "\(lat)"),
            URLQueryItem(name: "lon", value: "\(lon)"),
            URLQueryItem(name: "format", value: "jsonv2"),
            URLQueryItem(name: "addressdetails", value: "1"),
            URLQueryItem(name: "namedetails", value: "1"),
            URLQueryItem(name: "accept-language", value: "en"),
            URLQueryItem(name: "zoom", value: "\(zoom)"),
        ]

        guard let url = components.url else { return nil }
        var request = URLRequest(url: url)
        request.setValue("WingDex-iOS/1.0", forHTTPHeaderField: "User-Agent")

        let (data, _) = try await URLSession.shared.data(for: request)
        let result = try JSONDecoder().decode(NominatimResult.self, from: data)

        let score = scoreNominatimResult(result)
        guard score >= 30 else { return nil }
        return formatGeoResult(result)
    }

    /// Score a Nominatim result by category relevance (matches web's scoreResult).
    private func scoreNominatimResult(_ result: NominatimResult) -> Int {
        var score = 0
        let category = (result.category ?? "").lowercased()
        let type = (result.type ?? "").lowercased()
        let hasName = result.name != nil || result.namedetails?["name:en"] != nil || result.namedetails?["name"] != nil

        if category == "leisure" && type == "park" { score += 100 }
        else if category == "boundary" && type == "protected_area" { score += 95 }
        else if category == "natural" { score += 80 }
        else if category == "waterway" { score += 72 }
        else if category == "place" && ["suburb", "neighbourhood", "village", "town"].contains(type) { score += 60 }
        else if category == "boundary" && type == "administrative" { score += 45 }
        else { score += 30 }

        if hasName { score += 5 }
        let addr = result.address
        if addr?["city"] != nil || addr?["town"] != nil || addr?["village"] != nil || addr?["county"] != nil {
            score += 5
        }
        return min(score, 100)
    }

    /// Format a Nominatim result into a display-friendly label with region codes.
    private func formatGeoResult(_ result: NominatimResult) -> GeoResult {
        let englishName = result.namedetails?["name:en"] ?? result.namedetails?["name"]
        let addr = result.address ?? [:]

        // Find primary name by priority: english name > result name > place type
        let primary: String? = englishName
            ?? result.name
            ?? firstNonNil(addr, keys: ["park", "nature_reserve", "neighbourhood", "suburb",
                                        "village", "town", "city", "county", "state"])

        // Find locality for the secondary label component
        let locality: String? = firstNonNil(addr, keys: ["neighbourhood", "suburb", "village",
                                                          "town", "city", "county"])

        var parts = [primary, locality, addr["state"]].compactMap { $0 }
        // Deduplicate while preserving order
        var seen = Set<String>()
        parts = parts.filter { seen.insert($0).inserted }
        let name = parts.prefix(3).joined(separator: ", ")

        let region = extractRegionCodes(result)
        return GeoResult(name: name, stateProvince: region.stateProvince, countryCode: region.countryCode)
    }

    /// Extract ISO 3166-2 state/province code and country code from a Nominatim result.
    private func extractRegionCodes(_ result: NominatimResult) -> (stateProvince: String?, countryCode: String?) {
        let addr = result.address ?? [:]
        let countryCode = addr["country_code"]?.trimmingCharacters(in: .whitespaces).uppercased()

        // Try direct ISO3166-2 fields
        let directState = normalizeStateCode(addr["ISO3166-2-lvl4"])
            ?? normalizeStateCode(addr["ISO3166-2-lvl3"])
            ?? normalizeStateCode(addr["ISO3166-2-lvl5"])

        if let directState {
            return (directState, countryCode)
        }

        // Construct from country + state code
        if let cc = countryCode {
            let stateCode = (addr["state_code"] ?? addr["region_code"])?.trimmingCharacters(in: .whitespaces).uppercased()
            if let sc = stateCode, sc.range(of: #"^[A-Z0-9]{1,6}$"#, options: .regularExpression) != nil {
                return ("\(cc)-\(sc)", cc)
            }
        }

        return (nil, countryCode)
    }

    /// Validate an ISO 3166-2 state/province code format.
    private func normalizeStateCode(_ raw: String?) -> String? {
        guard let value = raw?.trimmingCharacters(in: .whitespaces).uppercased(), !value.isEmpty else { return nil }
        return value.range(of: #"^[A-Z]{2}-[A-Z0-9]{1,6}$"#, options: .regularExpression) != nil ? value : nil
    }

    /// Return the first non-nil value from a dictionary for the given ordered keys.
    private func firstNonNil(_ dict: [String: String], keys: [String]) -> String? {
        for key in keys {
            if let value = dict[key] { return value }
        }
        return nil
    }

    /// Search for a place by name via Nominatim.
    private func searchPlace() {
        let query = placeQuery.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return }
        isSearchingPlace = true

        Task {
            defer { isSearchingPlace = false }
            do {
                var components = URLComponents(string: "https://nominatim.openstreetmap.org/search")!
                components.queryItems = [
                    URLQueryItem(name: "format", value: "jsonv2"),
                    URLQueryItem(name: "q", value: query),
                    URLQueryItem(name: "limit", value: "5"),
                    URLQueryItem(name: "addressdetails", value: "1"),
                    URLQueryItem(name: "accept-language", value: "en"),
                ]
                guard let url = components.url else { return }
                var request = URLRequest(url: url)
                request.setValue("WingDex-iOS/1.0", forHTTPHeaderField: "User-Agent")

                let (data, _) = try await URLSession.shared.data(for: request)
                let results = try JSONDecoder().decode([NominatimResult].self, from: data)
                placeResults = results.map { result in
                    NominatimPlace(
                        id: UUID().uuidString,
                        displayName: result.displayName ?? "",
                        lat: Double(result.lat ?? "0") ?? 0,
                        lon: Double(result.lon ?? "0") ?? 0,
                        address: result.address
                    )
                }
            } catch {
                log.error("Place search failed: \(error.localizedDescription)")
            }
        }
    }

    /// Select a place from search results.
    private func selectPlace(_ place: NominatimPlace) {
        overriddenCoords = CLLocationCoordinate2D(latitude: place.lat, longitude: place.lon)
        let shortName = place.displayName.split(separator: ",").prefix(3).joined(separator: ",").trimmingCharacters(in: .whitespaces)
        locationName = shortName
        suggestedLocation = shortName

        // Extract region from address
        let fakeResult = NominatimResult(
            name: nil, displayName: place.displayName,
            lat: "\(place.lat)", lon: "\(place.lon)",
            category: nil, type: nil,
            address: place.address, namedetails: nil
        )
        let region = extractRegionCodes(fakeResult)
        inferredStateProvince = region.stateProvince
        inferredCountryCode = region.countryCode

        placeResults = []
        placeQuery = ""
    }

    /// Apply the manually edited date and time.
    private func applyManualDateTime() {
        // Combine the date from manualDate and time from manualTime
        let calendar = Calendar.current
        var components = calendar.dateComponents([.year, .month, .day], from: manualDate)
        let timeComponents = calendar.dateComponents([.hour, .minute], from: manualTime)
        components.hour = timeComponents.hour
        components.minute = timeComponents.minute
        if let combined = calendar.date(from: components) {
            overriddenStartTime = combined
        }
        editingDateTime = false
    }

    /// Format the cluster date/time for display.
    private func formatClusterDateTime() -> String {
        let date = effectiveStartTime
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    /// Confirm the outing and proceed to species identification.
    private func handleConfirm() {
        if useExistingOuting, let existing = matchingOuting {
            // Merge into existing outing
            viewModel.outingConfirmed(outingId: existing.id, locationName: existing.locationName)
            return
        }

        // Create new outing
        let outingId = "outing_\(Int(Date().timeIntervalSince1970 * 1000))"
        let formatter = ISO8601DateFormatter()

        let finalLocationName = locationName.isEmpty ? "Unknown Location" : locationName
        let outing = Outing(
            id: outingId,
            userId: "",
            startTime: formatter.string(from: effectiveStartTime),
            endTime: formatter.string(from: effectiveEndTime),
            locationName: finalLocationName,
            defaultLocationName: finalLocationName,
            lat: effectiveLat,
            lon: effectiveLon,
            stateProvince: inferredStateProvince,
            countryCode: inferredCountryCode,
            notes: "",
            createdAt: formatter.string(from: Date())
        )

        Task {
            do {
                let service = DataService(auth: auth)
                let saved = try await service.createOuting(outing)
                viewModel.outingConfirmed(outingId: saved.id, locationName: finalLocationName)
            } catch {
                log.error("Failed to create outing: \(error.localizedDescription)")
                viewModel.error = error.localizedDescription
            }
        }
    }

    /// Find an existing outing that matches this cluster by time and location.
    /// Matches the web's `findMatchingOuting` algorithm from clustering.ts.
    private func findMatchingOuting(cluster: PhotoCluster, outings: [Outing]) -> Outing? {
        let timeThreshold: TimeInterval = 2 * 60 * 60 // 2 hours
        let tightTimeThreshold: TimeInterval = 30 * 60 // 30 minutes
        let maxDistanceKm = 3.0
        let relaxedDistanceKm = 50.0

        for outing in outings {
            let outingStart = DateFormatting.sortDate(outing.startTime).timeIntervalSince1970
            let outingEnd = DateFormatting.sortDate(outing.endTime).timeIntervalSince1970
            let clusterStart = cluster.startTime.timeIntervalSince1970
            let clusterEnd = cluster.endTime.timeIntervalSince1970

            // Check time overlap: cluster within +/-2 hours of outing window
            let timeOverlap = clusterStart <= outingEnd + timeThreshold
                && clusterEnd >= outingStart - timeThreshold
            guard timeOverlap else { continue }

            // If both have GPS, check distance
            if let cLat = cluster.centerLat, let cLon = cluster.centerLon,
               let oLat = outing.lat, let oLon = outing.lon
            {
                let dist = PhotoService.haversineDistance(lat1: cLat, lon1: cLon, lat2: oLat, lon2: oLon)

                // Tight time match (<=30 min): allow up to 50 km
                // Loose time match (<=2 hr): allow up to 3 km
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

// MARK: - Nominatim API Models

/// Decoded Nominatim API result.
private struct NominatimResult: Codable {
    let name: String?
    let displayName: String?
    let lat: String?
    let lon: String?
    let category: String?
    let type: String?
    let address: [String: String]?
    let namedetails: [String: String]?

    enum CodingKeys: String, CodingKey {
        case name
        case displayName = "display_name"
        case lat, lon, category, type, address, namedetails
    }
}

/// A place search result from Nominatim.
struct NominatimPlace: Identifiable {
    let id: String
    let displayName: String
    let lat: Double
    let lon: Double
    let address: [String: String]?
}

/// Formatted geocoding result with region codes.
private struct GeoResult {
    let name: String
    let stateProvince: String?
    let countryCode: String?
}

// MARK: - Preview

#Preview("With GPS") {
    NavigationStack {
        let vm = AddPhotosViewModel()
        OutingReviewView(viewModel: vm)
            .environment(AuthService())
            .environment(previewStore())
            .onAppear {
                // Simulate a cluster with GPS data at Discovery Park, Seattle
                vm.clusters = [PhotoCluster(
                    photos: [
                        ProcessedPhoto(id: "p1", image: Data(), thumbnail: Data(),
                                       exifTime: Date().addingTimeInterval(-3600),
                                       gpsLat: 47.6587, gpsLon: -122.4050,
                                       fileHash: "abc1", fileName: "eagle.jpg"),
                        ProcessedPhoto(id: "p2", image: Data(), thumbnail: Data(),
                                       exifTime: Date().addingTimeInterval(-3000),
                                       gpsLat: 47.6590, gpsLon: -122.4055,
                                       fileHash: "abc2", fileName: "heron.jpg"),
                        ProcessedPhoto(id: "p3", image: Data(), thumbnail: Data(),
                                       exifTime: Date().addingTimeInterval(-2400),
                                       gpsLat: 47.6585, gpsLon: -122.4048,
                                       fileHash: "abc3", fileName: "sparrow.jpg"),
                    ],
                    startTime: Date().addingTimeInterval(-3600),
                    endTime: Date(),
                    centerLat: 47.6587,
                    centerLon: -122.4050
                )]
            }
    }
}

#Preview("No GPS") {
    NavigationStack {
        let vm = AddPhotosViewModel()
        OutingReviewView(viewModel: vm)
            .environment(AuthService())
            .environment(previewStore())
            .onAppear {
                vm.clusters = [PhotoCluster(
                    photos: [
                        ProcessedPhoto(id: "p1", image: Data(), thumbnail: Data(),
                                       exifTime: Date(), gpsLat: nil, gpsLon: nil,
                                       fileHash: "abc1", fileName: "bird1.jpg"),
                    ],
                    startTime: Date(),
                    endTime: Date(),
                    centerLat: nil,
                    centerLon: nil
                )]
            }
    }
}

#Preview("Multi-Cluster") {
    NavigationStack {
        let vm = AddPhotosViewModel()
        OutingReviewView(viewModel: vm)
            .environment(AuthService())
            .environment(previewStore())
            .onAppear {
                // Two clusters from different locations/times
                vm.clusters = [
                    PhotoCluster(
                        photos: [
                            ProcessedPhoto(id: "p1", image: Data(), thumbnail: Data(),
                                           exifTime: Date().addingTimeInterval(-7200),
                                           gpsLat: 47.6587, gpsLon: -122.4050,
                                           fileHash: "abc1", fileName: "morning.jpg"),
                        ],
                        startTime: Date().addingTimeInterval(-7200),
                        endTime: Date().addingTimeInterval(-3600),
                        centerLat: 47.6587, centerLon: -122.4050
                    ),
                    PhotoCluster(
                        photos: [
                            ProcessedPhoto(id: "p2", image: Data(), thumbnail: Data(),
                                           exifTime: Date(),
                                           gpsLat: 40.6155, gpsLon: -73.8227,
                                           fileHash: "abc2", fileName: "afternoon.jpg"),
                        ],
                        startTime: Date(),
                        endTime: Date(),
                        centerLat: 40.6155, centerLon: -73.8227
                    ),
                ]
            }
    }
}
