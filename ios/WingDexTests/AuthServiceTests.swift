@testable import WingDex
import XCTest

final class AuthCallbackParsingTests: XCTestCase {

    // MARK: - parseCallbackURL

    func testValidCallbackWithAllParams() throws {
        let url = URL(string: "wingdex://auth/callback?token=abc123&signed_token=abc123.sig%252Bvalue&expires_at=2026-03-14T19:41:56.066Z&user_id=user1&user_name=John&user_email=john@example.com&user_image=https://example.com/photo.jpg")!
        let result = try AuthService.parseCallbackURL(url)

        XCTAssertEqual(result.token, "abc123")
        XCTAssertEqual(result.signedToken, "abc123.sig%2Bvalue")
        XCTAssertEqual(result.userId, "user1")
        XCTAssertEqual(result.userName, "John")
        XCTAssertEqual(result.userEmail, "john@example.com")
        XCTAssertEqual(result.userImage, "https://example.com/photo.jpg")
        XCTAssertNotNil(result.expiry)
    }

    func testValidCallbackWithMinimalParams() throws {
        let url = URL(string: "wingdex://auth/callback?token=abc123&expires_at=2026-03-14T19:41:56Z")!
        let result = try AuthService.parseCallbackURL(url)

        XCTAssertEqual(result.token, "abc123")
        XCTAssertNil(result.signedToken)
        XCTAssertNil(result.userId)
        XCTAssertNil(result.userName)
        XCTAssertNil(result.userEmail)
        XCTAssertNil(result.userImage)
    }

    func testCallbackWithURLEncodedValues() throws {
        let url = URL(string: "wingdex://auth/callback?token=abc%3D123&expires_at=2026-03-14T19%3A41%3A56.066Z&user_name=John%20Lian&user_email=john%40example.com")!
        let result = try AuthService.parseCallbackURL(url)

        XCTAssertEqual(result.token, "abc=123")
        XCTAssertEqual(result.userName, "John Lian")
        XCTAssertEqual(result.userEmail, "john@example.com")
    }

    func testCallbackWithErrorParam() {
        let url = URL(string: "wingdex://auth/callback?error=no_session")!

        XCTAssertThrowsError(try AuthService.parseCallbackURL(url)) { error in
            XCTAssertTrue(error.localizedDescription.contains("no_session"))
        }
    }

    func testCallbackMissingToken() {
        let url = URL(string: "wingdex://auth/callback?expires_at=2026-03-14T19:41:56Z&user_id=user1")!

        XCTAssertThrowsError(try AuthService.parseCallbackURL(url)) { error in
            XCTAssertTrue(error.localizedDescription.contains("Missing token"))
        }
    }

    func testCallbackMissingExpiresAt() {
        let url = URL(string: "wingdex://auth/callback?token=abc123&user_id=user1")!

        XCTAssertThrowsError(try AuthService.parseCallbackURL(url)) { error in
            XCTAssertTrue(error.localizedDescription.contains("Missing token"))
        }
    }

    func testCallbackInvalidExpiryDate() {
        let url = URL(string: "wingdex://auth/callback?token=abc123&expires_at=not-a-date")!

        XCTAssertThrowsError(try AuthService.parseCallbackURL(url)) { error in
            XCTAssertTrue(error.localizedDescription.contains("Invalid expiry"))
        }
    }

    func testCallbackEmptyURL() {
        let url = URL(string: "wingdex://auth/callback")!

        XCTAssertThrowsError(try AuthService.parseCallbackURL(url))
    }

    // MARK: - parseISO8601

    func testISO8601WithFractionalSeconds() {
        let date = AuthService.parseISO8601("2026-03-14T19:41:56.066Z")
        XCTAssertNotNil(date)
    }

    func testISO8601WithoutFractionalSeconds() {
        let date = AuthService.parseISO8601("2026-03-14T19:41:56Z")
        XCTAssertNotNil(date)
    }

    func testISO8601WithTimezoneOffset() {
        let date = AuthService.parseISO8601("2026-03-14T12:41:56-07:00")
        XCTAssertNotNil(date)
    }

    func testISO8601WithHighPrecisionFractional() {
        let date = AuthService.parseISO8601("2026-03-14T19:41:56.123456Z")
        XCTAssertNotNil(date)
    }

    func testISO8601InvalidString() {
        let date = AuthService.parseISO8601("March 14, 2026")
        XCTAssertNil(date)
    }

    func testISO8601EmptyString() {
        let date = AuthService.parseISO8601("")
        XCTAssertNil(date)
    }

    // MARK: - Token extraction from real-world callback URLs

    func testRealWorldGitHubCallbackURL() throws {
        // Simulates what the mobile/callback endpoint sends with encodeURIComponent
        // (spaces as %20, not + as URLSearchParams would produce)
        let url = URL(string: "wingdex://auth/callback?token=hf2znuT4gSpDhB3VJkjAFsyH6wahdBP2&signed_token=hf2znuT4gSpDhB3VJkjAFsyH6wahdBP2.WxY%252Bsig%253D&expires_at=2026-03-14T19%3A41%3A56.066Z&user_id=w3mYQIVlKKAlUANNqylaCCEJrG0du0Fw&user_name=John%20Lian&user_email=lianguanlun%40gmail.com&user_image=https%3A%2F%2Favatars.githubusercontent.com%2Fu%2F2320572%3Fv%3D4")!

        let result = try AuthService.parseCallbackURL(url)
        XCTAssertEqual(result.token, "hf2znuT4gSpDhB3VJkjAFsyH6wahdBP2")
        XCTAssertEqual(result.signedToken, "hf2znuT4gSpDhB3VJkjAFsyH6wahdBP2.WxY%2Bsig%3D")
        XCTAssertEqual(result.userId, "w3mYQIVlKKAlUANNqylaCCEJrG0du0Fw")
        XCTAssertEqual(result.userName, "John Lian")
        XCTAssertEqual(result.userEmail, "lianguanlun@gmail.com")
        XCTAssertTrue(result.userImage?.contains("avatars.githubusercontent.com") ?? false)
        XCTAssertNotNil(result.expiry)
    }
}

// MARK: - Config Tests

final class ConfigURLTests: XCTestCase {

    func testAPIBaseURLIsValid() {
        let url = Config.apiBaseURL
        XCTAssertNotNil(url.host)
        XCTAssertTrue(url.scheme == "http" || url.scheme == "https")
    }

    func testBundleID() {
        XCTAssertEqual(Config.bundleID, "app.wingdex")
    }

    func testOAuthCallbackScheme() {
        XCTAssertEqual(Config.oauthCallbackScheme, "wingdex")
    }

    func testRPIDMatchesAPIHost() {
        XCTAssertEqual(Config.rpID, Config.apiBaseURL.host)
    }

    func testAIDailyRateLimit() {
        XCTAssertEqual(Config.aiDailyRateLimit, 150)
    }
}
