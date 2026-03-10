@testable import WingDex
import XCTest

/// Integration tests that run against the actual API server.
/// Requires the dev server to be running (wingdev.johnspecificproblems.net or localhost:5000).
///
/// These tests use anonymous sign-in (no OAuth required) to verify
/// the Bearer token auth flow works end-to-end from Swift code.
final class AuthIntegrationTests: XCTestCase {

    private let baseURL = Config.apiBaseURL
    private let timeout: TimeInterval = 10

    // MARK: - Anonymous Sign-In + Bearer Auth

    func testAnonymousSignInReturnsBearerToken() async throws {
        let token = try await signInAnonymously()
        XCTAssertFalse(token.isEmpty, "Token should not be empty")
        XCTAssertGreaterThan(token.count, 10, "Token should be a reasonable length")
    }

    func testBearerTokenFetchesData() async throws {
        let token = try await signInAnonymously()

        let url = baseURL.appendingPathComponent("api/data/all")
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)
        let http = try XCTUnwrap(response as? HTTPURLResponse)
        XCTAssertEqual(http.statusCode, 200, "Bearer auth should succeed")

        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertNotNil(json?["outings"], "Response should contain outings")
    }

    func testInvalidBearerTokenReturns401() async throws {
        let url = baseURL.appendingPathComponent("api/data/all")
        var request = URLRequest(url: url)
        request.setValue("Bearer invalid-token-12345", forHTTPHeaderField: "Authorization")

        let (_, response) = try await URLSession.shared.data(for: request)
        let http = try XCTUnwrap(response as? HTTPURLResponse)
        XCTAssertEqual(http.statusCode, 401, "Invalid token should return 401")
    }

    func testNoBearerTokenReturns401() async throws {
        // Clear any session cookies from prior tests so this is truly unauthenticated.
        if let cookies = HTTPCookieStorage.shared.cookies(for: baseURL) {
            for cookie in cookies { HTTPCookieStorage.shared.deleteCookie(cookie) }
        }

        let url = baseURL.appendingPathComponent("api/data/all")
        let request = URLRequest(url: url)

        let (_, response) = try await URLSession.shared.data(for: request)
        let http = try XCTUnwrap(response as? HTTPURLResponse)
        XCTAssertEqual(http.statusCode, 401, "No auth should return 401")
    }

    func testBearerGetSessionReturnsUser() async throws {
        let token = try await signInAnonymously()

        let url = baseURL.appendingPathComponent("api/auth/get-session")
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)
        let http = try XCTUnwrap(response as? HTTPURLResponse)
        XCTAssertEqual(http.statusCode, 200)

        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let user = json?["user"] as? [String: Any]
        XCTAssertNotNil(user?["id"], "get-session should return user with id")
    }

    func testBearerCRUDRoundtrip() async throws {
        let token = try await signInAnonymously()

        // Create outing
        let outingId = "integration-test-\(Int(Date.now.timeIntervalSince1970))"
        let createURL = baseURL.appendingPathComponent("api/data/outings")
        var createReq = URLRequest(url: createURL)
        createReq.httpMethod = "POST"
        createReq.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        createReq.setValue("application/json", forHTTPHeaderField: "Content-Type")
        createReq.httpBody = try JSONSerialization.data(withJSONObject: [
            "id": outingId,
            "startTime": "2026-03-07T08:00:00.000Z",
            "endTime": "2026-03-07T09:00:00.000Z",
            "locationName": "Integration Test Park",
            "createdAt": "2026-03-07T09:00:00.000Z",
        ])

        let (_, createResp) = try await URLSession.shared.data(for: createReq)
        let createHttp = try XCTUnwrap(createResp as? HTTPURLResponse)
        XCTAssertEqual(createHttp.statusCode, 200, "Create outing should succeed")

        // Verify it exists
        let allURL = baseURL.appendingPathComponent("api/data/all")
        var allReq = URLRequest(url: allURL)
        allReq.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (allData, _) = try await URLSession.shared.data(for: allReq)
        let allJson = try JSONSerialization.jsonObject(with: allData) as? [String: Any]
        let outings = allJson?["outings"] as? [[String: Any]] ?? []
        XCTAssertTrue(outings.contains { ($0["id"] as? String) == outingId }, "Created outing should appear in data")

        // Delete it
        let deleteURL = baseURL.appendingPathComponent("api/data/outings/\(outingId)")
        var deleteReq = URLRequest(url: deleteURL)
        deleteReq.httpMethod = "DELETE"
        deleteReq.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (_, deleteResp) = try await URLSession.shared.data(for: deleteReq)
        let deleteHttp = try XCTUnwrap(deleteResp as? HTTPURLResponse)
        XCTAssertEqual(deleteHttp.statusCode, 200, "Delete outing should succeed")
    }

    // MARK: - Helpers

    /// Sign in anonymously and return the raw session token.
    private func signInAnonymously() async throws -> String {
        let url = baseURL.appendingPathComponent("api/auth/sign-in/anonymous")

        // Clear stale session cookies so Better Auth doesn't reject with
        // "Anonymous users cannot sign in again anonymously".
        if let cookies = HTTPCookieStorage.shared.cookies(for: baseURL) {
            for cookie in cookies { HTTPCookieStorage.shared.deleteCookie(cookie) }
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(baseURL.absoluteString, forHTTPHeaderField: "Origin")
        request.httpBody = Data("{}".utf8)

        let (data, response) = try await URLSession.shared.data(for: request)
        let http = try XCTUnwrap(response as? HTTPURLResponse)
        XCTAssertEqual(http.statusCode, 200, "Anonymous sign-in should succeed")

        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        let token = try XCTUnwrap(json["token"] as? String)

        // Clear cookies set by sign-in so subsequent requests use only the
        // Bearer header, matching how the app works (AuthService.clearAPICookies).
        if let cookies = HTTPCookieStorage.shared.cookies(for: baseURL) {
            for cookie in cookies { HTTPCookieStorage.shared.deleteCookie(cookie) }
        }

        return token
    }
}
