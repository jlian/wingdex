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
        try attachAuth(&request)

        log.debug("GET \(path)")
        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        log.debug("GET \(path) -> \(data.count) bytes")
        return data
    }

    @discardableResult
    private func patch(_ path: String, body data: Data) async throws -> Data {
        let url = Config.apiBaseURL.appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        try attachAuth(&request)

        let (responseData, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: responseData)
        return responseData
    }

    @discardableResult
    private func delete(_ path: String) async throws -> Data {
        let url = Config.apiBaseURL.appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        try attachAuth(&request)

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        return data
    }

    private func attachAuth(_ request: inout URLRequest) throws {
        let token = try auth.validToken()
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }

    private func validate(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw DataServiceError.networkError("Invalid response")
        }
        guard (200...299).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            log.error("HTTP \(http.statusCode): \(body)")
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
