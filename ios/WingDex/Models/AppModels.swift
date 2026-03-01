import Foundation

// MARK: - Core Models
// These mirror the TypeScript types in src/lib/types.ts and the OpenAPI schema.
// They provide Identifiable + Codable conformance for use in SwiftUI views
// and manual API calls. When the generated OpenAPI client is wired up,
// these may be replaced by or mapped from the generated types.

struct Outing: Codable, Identifiable, Hashable {
    let id: String
    let userId: String
    let startTime: String
    let endTime: String
    let locationName: String
    var defaultLocationName: String?
    var lat: Double?
    var lon: Double?
    var stateProvince: String?
    var countryCode: String?
    var `protocol`: String?
    var numberObservers: Int?
    var allObsReported: Bool?
    var effortDistanceMiles: Double?
    var effortAreaAcres: Double?
    var notes: String
    let createdAt: String
}

struct Photo: Codable, Identifiable, Hashable {
    let id: String
    let outingId: String
    let dataUrl: String
    let thumbnail: String
    var exifTime: String?
    var gps: GPS?
    let fileHash: String
    let fileName: String

    struct GPS: Codable, Hashable {
        let lat: Double
        let lon: Double
    }
}

enum ObservationStatus: String, Codable, CaseIterable {
    case confirmed
    case possible
    case pending
    case rejected
}

struct BirdObservation: Codable, Identifiable, Hashable {
    let id: String
    let outingId: String
    let speciesName: String
    var count: Int
    var certainty: ObservationStatus
    var representativePhotoId: String?
    var aiConfidence: Double?
    var speciesComments: String?
    var notes: String
}

struct DexEntry: Codable, Identifiable, Hashable {
    let speciesName: String
    let firstSeenDate: String
    let lastSeenDate: String
    var addedDate: String?
    let totalOutings: Int
    let totalCount: Int
    var bestPhotoId: String?
    var notes: String
    var wikiTitle: String?
    var thumbnailUrl: String?

    /// Use speciesName as the stable identity.
    var id: String { speciesName }
}

// MARK: - API Response Types

struct AllDataResponse: Codable {
    let outings: [Outing]
    let photos: [Photo]
    let observations: [BirdObservation]
    let dex: [DexEntry]
}

struct DexUpdateResponse: Codable {
    let dexUpdates: [DexEntry]
}

struct ObservationsCreatedResponse: Codable {
    let observations: [BirdObservation]
    let dexUpdates: [DexEntry]
}

struct TokenPair: Codable {
    let accessToken: String
    let refreshToken: String
    let tokenType: String
    let expiresIn: Int

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case tokenType = "token_type"
        case expiresIn = "expires_in"
    }
}
