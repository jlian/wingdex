import Foundation
import os

private let log = Logger(subsystem: "app.wingdex", category: "DataService")

/// Handles all REST API communication with the WingDex backend.
///
/// Every endpoint attaches the session token via `Authorization: Bearer` header.
/// The server middleware translates this to a session cookie for Better Auth.
final class DataService: Sendable {
    private let auth: AuthService

    init(auth: AuthService) {
        self.auth = auth
    }

    // MARK: - Bulk Fetch

    /// Fetch all user data in a single request.
    func fetchAllData() async throws -> AllDataResponse {
        try await get("api/data/all")
    }

    // MARK: - Outings

    func deleteOuting(id: String) async throws {
        try await delete("api/data/outings/\(id)")
    }

    func updateOuting(id: String, fields: OutingUpdate) async throws {
        let data = try JSONEncoder().encode(fields)
        try await patch("api/data/outings/\(id)", body: data)
    }

    // MARK: - Observations

    func rejectObservations(ids: [String]) async throws {
        struct Update: Codable { let id: String; let certainty: String }
        let updates = ids.map { Update(id: $0, certainty: "rejected") }
        let data = try JSONEncoder().encode(updates)
        try await patch("api/data/observations", body: data)
    }

    // MARK: - Create Operations

    struct CreateOutingResponse: Codable {
        let id: String
        let userId: String
        let startTime: String
        let endTime: String
        let locationName: String
        let notes: String
        let createdAt: String
    }

    func createOuting(_ outing: Outing) async throws -> Outing {
        let data = try JSONEncoder().encode(outing)
        let responseData = try await post("api/data/outings", body: data)
        return try JSONDecoder().decode(Outing.self, from: responseData)
    }

    struct PhotoPayload: Codable {
        let id: String
        let outingId: String
        let exifTime: String?
        let gps: PhotoGPS?
        let fileHash: String
        let fileName: String

        struct PhotoGPS: Codable {
            let lat: Double
            let lon: Double
        }
    }

    func createPhotos(_ photos: [PhotoPayload]) async throws {
        let data = try JSONEncoder().encode(photos)
        try await post("api/data/photos", body: data)
    }

    struct ObservationsResponse: Codable {
        let observations: [BirdObservation]?
        let dexUpdates: [DexEntry]?
    }

    func createObservations(_ observations: [BirdObservation]) async throws -> ObservationsResponse {
        let data = try JSONEncoder().encode(observations)
        let responseData = try await post("api/data/observations", body: data)
        return try JSONDecoder().decode(ObservationsResponse.self, from: responseData)
    }

    // MARK: - AI Identification

    struct IdentifyBirdRequest: Codable {
        let imageDataUrl: String
        let imageWidth: Int
        let imageHeight: Int
        var lat: Double?
        var lon: Double?
        var month: Int?
        var locationName: String?
        let model: String
    }

    struct IdentifyBirdResponse: Codable {
        let candidates: [BirdCandidate]?
        let cropBox: CropBox?
        let multipleBirds: Bool?

        struct BirdCandidate: Codable {
            let species: String
            let confidence: Double
            let wikiTitle: String?
        }

        struct CropBox: Codable {
            let x: Double
            let y: Double
            let width: Double
            let height: Double
        }
    }

    func identifyBird(_ request: IdentifyBirdRequest) async throws -> IdentifyBirdResponse {
        let data = try JSONEncoder().encode(request)
        let responseData = try await post("api/identify-bird", body: data)
        return try JSONDecoder().decode(IdentifyBirdResponse.self, from: responseData)
    }

    // MARK: - Exports

    func exportSightingsCSV() async throws -> Data {
        try await getRaw("api/export/sightings")
    }

    func exportDexCSV() async throws -> Data {
        try await getRaw("api/export/dex")
    }

    func exportOutingCSV(outingId: String) async throws -> Data {
        try await getRaw("api/export/outing/\(outingId)")
    }

    // MARK: - Import

    struct ImportPreview: Codable {
        let previewId: String
        let speciesName: String?
        let conflict: String? // "new", "duplicate", "update_dates"
    }

    struct ImportPreviewResponse: Codable {
        let previews: [ImportPreview]
    }

    struct ImportConfirmResponse: Codable {
        let imported: ImportedCounts
        struct ImportedCounts: Codable {
            let outings: Int
            let newSpecies: Int
        }
    }

    /// Upload eBird CSV for preview with optional timezone conversion.
    func importEBirdCSVPreview(_ csvData: Data, profileTimezone: String?) async throws -> [ImportPreview] {
        let boundary = UUID().uuidString
        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"import.csv\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: text/csv\r\n\r\n".data(using: .utf8)!)
        body.append(csvData)
        body.append("\r\n".data(using: .utf8)!)

        if let tz = profileTimezone, tz != "observation-local" {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"profileTimezone\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(tz)\r\n".data(using: .utf8)!)
        }

        body.append("--\(boundary)--\r\n".data(using: .utf8)!)

        let url = Config.apiBaseURL.appendingPathComponent("api/import/ebird-csv")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        try await attachAuth(&request)

        let (responseData, response) = try await URLSession.shared.data(for: request)
        try await validate(response, data: responseData)

        let preview = try JSONDecoder().decode(ImportPreviewResponse.self, from: responseData)
        return preview.previews
    }

    /// Legacy import without timezone (used by demo data loader).
    func importEBirdCSV(_ csvData: Data) async throws -> [String] {
        let previews = try await importEBirdCSVPreview(csvData, profileTimezone: nil)
        return previews.map(\.previewId)
    }

    func confirmImport(previewIds: [String]) async throws -> ImportConfirmResponse {
        struct ConfirmBody: Codable { let previewIds: [String] }
        let data = try JSONEncoder().encode(ConfirmBody(previewIds: previewIds))
        let responseData = try await post("api/import/ebird-csv/confirm", body: data)
        return try JSONDecoder().decode(ImportConfirmResponse.self, from: responseData)
    }

    // MARK: - Data Management

    func clearAllData() async throws {
        try await delete("api/data/clear")
    }

    // MARK: - HTTP Primitives

    private func get<T: Decodable>(_ path: String) async throws -> T {
        let data = try await getRaw(path)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func getRaw(_ path: String) async throws -> Data {
        let url = Config.apiBaseURL.appendingPathComponent(path)
        var request = URLRequest(url: url)
        try await attachAuth(&request)

        log.debug("GET \(path)")
        let (data, response) = try await URLSession.shared.data(for: request)
        try await validate(response, data: data)
        log.debug("GET \(path) -> \(data.count) bytes")
        return data
    }

    @discardableResult
    private func post(_ path: String, body data: Data) async throws -> Data {
        let url = Config.apiBaseURL.appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        try await attachAuth(&request)

        let (responseData, response) = try await URLSession.shared.data(for: request)
        try await validate(response, data: responseData)
        return responseData
    }

    @discardableResult
    private func patch(_ path: String, body data: Data) async throws -> Data {
        let url = Config.apiBaseURL.appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        try await attachAuth(&request)

        let (responseData, response) = try await URLSession.shared.data(for: request)
        try await validate(response, data: responseData)
        return responseData
    }

    @discardableResult
    private func delete(_ path: String) async throws -> Data {
        let url = Config.apiBaseURL.appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        try await attachAuth(&request)

        let (data, response) = try await URLSession.shared.data(for: request)
        try await validate(response, data: data)
        return data
    }

    private func attachAuth(_ request: inout URLRequest) async throws {
        let token = try await auth.validToken()
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(Config.apiBaseURL.absoluteString, forHTTPHeaderField: "Origin")
        let method = request.httpMethod ?? "?"
        let path = request.url?.path ?? "?"
        log.debug("Request: \(method) \(path)")
    }

    private func validate(_ response: URLResponse, data: Data) async throws {
        guard let http = response as? HTTPURLResponse else {
            throw DataServiceError.networkError("Invalid response")
        }
        log.debug("Response: \(http.statusCode) for \(http.url?.path ?? "?")")
        guard (200...299).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            log.error("HTTP \(http.statusCode) \(http.url?.path ?? "?"): \(body)")
            // Server rejected the session - clear stale local auth state
            // so the UI shows the sign-in screen instead of a broken homepage.
            if http.statusCode == 401 {
                await auth.signOut()
            }
            throw DataServiceError.httpError(http.statusCode, body)
        }
    }
}

enum DataServiceError: LocalizedError {
    case networkError(String)
    case httpError(Int, String)

    var errorDescription: String? {
        switch self {
        case .networkError(let msg): msg
        case .httpError(let code, let body): "HTTP \(code): \(body)"
        }
    }
}
