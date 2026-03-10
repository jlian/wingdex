import Foundation
import Observation
import os

private let log = Logger(subsystem: "app.wingdex", category: "DataStore")

/// Typed update for outing fields. Only non-nil fields are sent.
struct OutingUpdate: Codable, Sendable {
    var locationName: String?
    var defaultLocationName: String?
    var notes: String?
}

/// Central observable data store for the app.
///
/// Fetches all user data from `GET /api/data/all` and provides computed
/// properties and helpers that views bind to. This replaces the individual
/// stub ViewModels (HomeViewModel, OutingsViewModel, WingDexViewModel) with
/// a single source of truth, mirroring the web app's `WingDexDataStore`.
@MainActor
@Observable
final class DataStore {
    // MARK: - Raw Data

    var outings: [Outing] = []
    var photos: [Photo] = []
    var observations: [BirdObservation] = []
    var dex: [DexEntry] = []

    // MARK: - State

    var isLoading = false
    var error: String?

    // MARK: - Dependencies

    private let service: DataService

    init(service: DataService) {
        self.service = service
    }

    // MARK: - Fetch

    /// Load all user data from the API. Called on app launch and pull-to-refresh.
    func loadAll() async {
        log.info("Loading all data...")
        isLoading = true
        error = nil
        do {
            let response = try await service.fetchAllData()
            outings = response.outings
            photos = response.photos
            observations = response.observations
            dex = response.dex
            log.info("Loaded \(self.outings.count) outings, \(self.observations.count) observations, \(self.dex.count) dex entries")
        } catch {
            self.error = error.localizedDescription
            log.error("Failed to load data: \(error.localizedDescription)")
        }
        isLoading = false
    }

    // MARK: - Derived Data

    /// Observations for a specific outing, excluding rejected ones.
    func outingObservations(_ outingId: String) -> [BirdObservation] {
        observations.filter { $0.outingId == outingId && $0.certainty != .rejected }
    }

    /// Confirmed observations for a specific outing.
    func confirmedObservations(_ outingId: String) -> [BirdObservation] {
        observations.filter { $0.outingId == outingId && $0.certainty == .confirmed }
    }

    /// Possible observations for a specific outing.
    func possibleObservations(_ outingId: String) -> [BirdObservation] {
        observations.filter { $0.outingId == outingId && $0.certainty == .possible }
    }

    /// Species count for an outing (confirmed only).
    func speciesCount(for outingId: String) -> Int {
        Set(confirmedObservations(outingId).map(\.speciesName)).count
    }

    /// Recent outings sorted by date descending, limited to `count`.
    func recentOutings(_ count: Int = 5) -> [Outing] {
        outings
            .sorted { DateFormatting.sortDate($0.startTime) > DateFormatting.sortDate($1.startTime) }
            .prefix(count)
            .map { $0 }
    }

    /// Recent species from the dex, sorted by firstSeenDate descending.
    func recentSpecies(_ count: Int = 6) -> [DexEntry] {
        dex
            .sorted { DateFormatting.sortDate($0.firstSeenDate) > DateFormatting.sortDate($1.firstSeenDate) }
            .prefix(count)
            .map { $0 }
    }

    /// All sightings of a species across outings.
    func sightings(for speciesName: String) -> [(observation: BirdObservation, outing: Outing)] {
        var results: [(BirdObservation, Outing)] = []
        let outingMap = Dictionary(uniqueKeysWithValues: outings.map { ($0.id, $0) })
        for obs in observations where obs.speciesName == speciesName && obs.certainty != .rejected {
            if let outing = outingMap[obs.outingId] {
                results.append((obs, outing))
            }
        }
        return results.sorted { DateFormatting.sortDate($0.1.startTime) > DateFormatting.sortDate($1.1.startTime) }
    }

    /// Find an outing by ID.
    func outing(id: String) -> Outing? {
        outings.first { $0.id == id }
    }

    /// Find a dex entry by species name.
    func dexEntry(for speciesName: String) -> DexEntry? {
        dex.first { $0.speciesName == speciesName }
    }

    // MARK: - Mutations

    /// Delete an outing and remove its observations locally, then sync with server.
    func deleteOuting(id: String) async {
        outings.removeAll { $0.id == id }
        observations.removeAll { $0.outingId == id }
        photos.removeAll { $0.outingId == id }
        do {
            try await service.deleteOuting(id: id)
        } catch {
            // Reload to reconcile if server call fails
            await loadAll()
        }
    }

    /// Mark observations as rejected (soft delete).
    func rejectObservations(ids: [String]) async {
        for i in observations.indices where ids.contains(observations[i].id) {
            observations[i].certainty = .rejected
        }
        do {
            try await service.rejectObservations(ids: ids)
        } catch {
            await loadAll()
        }
    }

    /// Update outing fields locally and on the server.
    func updateOuting(id: String, fields: OutingUpdate) async {
        if let idx = outings.firstIndex(where: { $0.id == id }) {
            let old = outings[idx]
            outings[idx] = Outing(
                id: old.id,
                userId: old.userId,
                startTime: old.startTime,
                endTime: old.endTime,
                locationName: fields.locationName ?? old.locationName,
                defaultLocationName: fields.defaultLocationName ?? old.defaultLocationName,
                lat: old.lat,
                lon: old.lon,
                stateProvince: old.stateProvince,
                countryCode: old.countryCode,
                protocol: old.protocol,
                numberObservers: old.numberObservers,
                allObsReported: old.allObsReported,
                effortDistanceMiles: old.effortDistanceMiles,
                effortAreaAcres: old.effortAreaAcres,
                notes: fields.notes ?? old.notes,
                createdAt: old.createdAt
            )
        }
        do {
            try await service.updateOuting(id: id, fields: fields)
        } catch {
            await loadAll()
        }
    }

    /// Clear all user data.
    func clearAll() async throws {
        try await service.clearAllData()
        outings = []
        photos = []
        observations = []
        dex = []
    }

    /// Load demo data by importing the bundled eBird CSV.
    func loadDemoData() async throws {
        guard let csvURL = Bundle.main.url(forResource: "demo-ebird-import", withExtension: "csv"),
              let csvData = try? Data(contentsOf: csvURL)
        else {
            throw DataServiceError.networkError("Demo CSV not found in bundle")
        }

        // Clear existing data first
        try await clearAll()

        // Upload CSV for preview
        let previewIds = try await service.importEBirdCSV(csvData)

        // Confirm all previews
        _ = try await service.confirmImport(previewIds: previewIds)

        // Reload all data
        await loadAll()
    }
}
