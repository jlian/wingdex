#if DEBUG
import Foundation

/// Deterministic account snapshots for UI tests. AuthTransportTests exercise
/// native HTTP behavior; the Worker tests own backend integration coverage.
actor UITestDataService: DataStoreService {
    enum Mode: Sendable {
        case empty
        case populated

        init?(arguments: [String]) {
            if arguments.contains("--ui-test-fixture-populated") {
                self = .populated
            } else if arguments.contains("--ui-test-fixture-empty") {
                self = .empty
            } else {
                return nil
            }
        }
    }

    private var response: AllDataResponse
    private let allowsOutingUpdates: Bool
    private let allowsPhotoUploads: Bool

    init(mode: Mode, allowsOutingUpdates: Bool = false, allowsPhotoUploads: Bool = false) {
        response = mode == .empty
            ? AllDataResponse(outings: [], photos: [], observations: [], dex: [])
            : Self.populatedResponse
        self.allowsOutingUpdates = allowsOutingUpdates
        self.allowsPhotoUploads = allowsPhotoUploads
    }

    func fetchAllData() async throws -> AllDataResponse {
        response
    }

    func submitPendingUpload(_ upload: PendingPhotoUpload) async throws -> DataService.ObservationsResponse {
        guard allowsPhotoUploads,
              let submitted = upload.outing ?? response.outings.first(where: { $0.id == upload.observations.first?.outingId }),
              submitted.userId.isEmpty || submitted.userId == upload.accountID
        else { throw URLError(.unsupportedURL) }
        // The API, not the client draft, assigns the authenticated outing owner.
        let outing = Outing(
            id: submitted.id, userId: upload.accountID, startTime: submitted.startTime,
            endTime: submitted.endTime, locationName: submitted.locationName,
            defaultLocationName: submitted.defaultLocationName, lat: submitted.lat, lon: submitted.lon,
            stateProvince: submitted.stateProvince, countryCode: submitted.countryCode,
            protocol: submitted.protocol, numberObservers: submitted.numberObservers,
            allObsReported: submitted.allObsReported, effortDistanceMiles: submitted.effortDistanceMiles,
            effortAreaAcres: submitted.effortAreaAcres, notes: submitted.notes, createdAt: submitted.createdAt
        )
        let outings = response.outings.filter { $0.id != outing.id } + [outing]
        let photos = response.photos.filter { photo in !upload.photos.contains { $0.id == photo.id } }
            + upload.photos.map {
                Photo(
                    id: $0.id, outingId: $0.outingId, dataUrl: "", thumbnail: "",
                    exifTime: $0.exifTime, gps: $0.gps.map { Photo.GPS(lat: $0.lat, lon: $0.lon) },
                    fileHash: $0.fileHash, fileName: $0.fileName
                )
            }
        let observations = response.observations.filter { observation in
            !upload.observations.contains { $0.id == observation.id }
        } + upload.observations
        let dex = groupByDexKey(observations).map { group in
            let sightings = group.observations
            let dates = outings.filter { outing in sightings.contains { $0.outingId == outing.id } }
                .map(\.startTime).sorted()
            return DexEntry(
                speciesName: group.label, speciesCode: sightings.first?.speciesCode,
                firstSeenDate: dates.first ?? outing.startTime,
                lastSeenDate: dates.last ?? outing.startTime,
                totalOutings: Set(sightings.map(\.outingId)).count,
                totalCount: sightings.reduce(0) { $0 + $1.count }, notes: ""
            )
        }
        response = AllDataResponse(outings: outings, photos: photos, observations: observations, dex: dex)
        return DataService.ObservationsResponse(observations: upload.observations, dexUpdates: dex)
    }

    func deleteOuting(id _: String) async throws -> DexUpdateResponse {
        throw URLError(.unsupportedURL)
    }

    func updateOuting(id: String, fields: OutingUpdate) async throws -> Outing {
        guard allowsOutingUpdates, let outing = response.outings.first(where: { $0.id == id }) else {
            throw URLError(.unsupportedURL)
        }
        let updated = Outing(
            id: outing.id, userId: outing.userId, startTime: outing.startTime, endTime: outing.endTime,
            locationName: fields.locationName ?? outing.locationName,
            defaultLocationName: fields.defaultLocationName ?? outing.defaultLocationName,
            lat: outing.lat, lon: outing.lon, stateProvince: outing.stateProvince, countryCode: outing.countryCode,
            protocol: outing.protocol, numberObservers: outing.numberObservers, allObsReported: outing.allObsReported,
            effortDistanceMiles: outing.effortDistanceMiles, effortAreaAcres: outing.effortAreaAcres,
            notes: fields.notes ?? outing.notes, createdAt: outing.createdAt
        )
        response = AllDataResponse(
            outings: response.outings.map { $0.id == id ? updated : $0 },
            photos: response.photos, observations: response.observations, dex: response.dex
        )
        return updated
    }

    func updateDexEntry(fields _: DexUpdate) async throws -> [DexEntry] {
        throw URLError(.unsupportedURL)
    }

    func rejectObservations(ids _: [String]) async throws -> DataService.ObservationsResponse {
        throw URLError(.unsupportedURL)
    }

    func searchSpecies(query _: String, limit _: Int) async throws -> [DataService.SpeciesSearchResult] {
        []
    }

    func createObservations(_ observations: [BirdObservation]) async throws -> DataService.ObservationsResponse {
        throw URLError(.unsupportedURL)
    }

    func exportOutingCSV(outingId _: String) async throws -> Data {
        Data()
    }

    func importEBirdCSV(_ csvData: Data, profileTimezone _: String?) async throws -> DataService.ImportResponse {
        throw URLError(.unsupportedURL)
    }

    func clearAllData() async throws {
        throw URLError(.unsupportedURL)
    }

    private static let populatedResponse: AllDataResponse = {
        let primaryOuting = Outing(
            id: "ui-test-seeded-outing",
            userId: "ui-test-account",
            startTime: "2026-02-12T06:58:00-03:00",
            endTime: "2026-02-12T07:58:00-03:00",
            locationName: "Parque Ibirapuera, Sao Paulo",
            lat: -23.5875,
            lon: -46.6575,
            notes: "UI test seed",
            createdAt: "2026-02-12T06:58:00-03:00"
        )
        let rarityOuting = Outing(
            id: "ui-test-seeded-rarity-outing",
            userId: "ui-test-account",
            startTime: "2026-01-18T08:30:00-08:00",
            endTime: "2026-01-18T10:30:00-08:00",
            locationName: "Carkeek Park, Seattle",
            lat: 47.61,
            lon: -122.33,
            notes: "UI test seed, rarity states",
            createdAt: "2026-01-18T08:30:00-08:00"
        )
        let species: [(id: String, outingID: String, name: String)] = [
            ("chalk-browed", primaryOuting.id, "Chalk-browed Mockingbird (Mimus saturninus)"),
            ("eared-dove", primaryOuting.id, "Eared Dove (Zenaida auriculata)"),
            ("robin", rarityOuting.id, "American Robin (Turdus migratorius)"),
            ("rufous", rarityOuting.id, "Rufous Hummingbird (Selasphorus rufus)"),
            ("tundra-swan", rarityOuting.id, "Tundra Swan (Cygnus columbianus)"),
            ("cardinal", rarityOuting.id, "Northern Cardinal (Cardinalis cardinalis)"),
        ]
        // A hybrid and one of its parents: the parent list on a compound entry links
        // through to a species page, and the parent may or may not be in the dex.
        let mallard = CompoundTaxonParent(
            commonName: "Mallard",
            scientificName: "Anas platyrhynchos",
            speciesCode: "mallar3",
            wikiTitle: "Mallard",
            thumbnailUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Anas_platyrhynchos_male_female_quadrat.jpg/330px-Anas_platyrhynchos_male_female_quadrat.jpg",
            birdlifeId: "22680186"
        )
        let blackDuck = CompoundTaxonParent(
            commonName: "American Black Duck",
            scientificName: "Anas rubripes",
            speciesCode: "ambduc",
            wikiTitle: "American black duck",
            thumbnailUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f9/American_Black_Duck_pair_at_Green_Wood_Cemetery%2C_Brooklyn_%2862110%29.jpg/330px-American_Black_Duck_pair_at_Green_Wood_Cemetery%2C_Brooklyn_%2862110%29.jpg",
            birdlifeId: "22680217"
        )
        let observations = species.map { fixture in
            BirdObservation(
                id: "ui-test-\(fixture.id)",
                outingId: fixture.outingID,
                speciesName: fixture.name,
                count: 1,
                certainty: .confirmed,
                notes: ""
            )
        } + [
            BirdObservation(
                id: "ui-test-hybrid",
                outingId: rarityOuting.id,
                speciesName: "Mallard x American Black Duck (hybrid)",
                count: 1,
                certainty: .confirmed,
                notes: ""
            ),
            BirdObservation(
                id: "ui-test-mallard",
                outingId: rarityOuting.id,
                speciesName: "Mallard (Anas platyrhynchos)",
                count: 2,
                certainty: .confirmed,
                notes: ""
            ),
        ]
        let compoundDex = [
            DexEntry(
                speciesName: "Mallard x American Black Duck (hybrid)",
                speciesCode: "x00001",
                commonName: "Mallard x American Black Duck (hybrid)",
                firstSeenDate: rarityOuting.startTime,
                lastSeenDate: rarityOuting.endTime,
                totalOutings: 1,
                totalCount: 1,
                notes: "",
                wikiTitle: "Mallard",
                borrowedFrom: "Mallard",
                compound: CompoundTaxon(kind: "hybrid", parents: [mallard, blackDuck])
            ),
            DexEntry(
                speciesName: "Mallard (Anas platyrhynchos)",
                speciesCode: "mallar3",
                commonName: "Mallard",
                scientificName: "Anas platyrhynchos",
                firstSeenDate: rarityOuting.startTime,
                lastSeenDate: rarityOuting.endTime,
                totalOutings: 1,
                totalCount: 2,
                notes: "",
                wikiTitle: "Mallard"
            ),
        ]
        let dex = species.map { fixture in
            DexEntry(
                speciesName: fixture.name,
                firstSeenDate: fixture.outingID == primaryOuting.id
                    ? primaryOuting.startTime
                    : rarityOuting.startTime,
                lastSeenDate: fixture.outingID == primaryOuting.id
                    ? primaryOuting.endTime
                    : rarityOuting.endTime,
                totalOutings: 1,
                totalCount: 1,
                notes: ""
            )
        } + compoundDex
        return AllDataResponse(
            outings: [primaryOuting, rarityOuting],
            photos: [],
            observations: observations,
            dex: dex
        )
    }()
}
#endif
