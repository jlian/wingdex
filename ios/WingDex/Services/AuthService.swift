import AuthenticationServices
import Foundation
import KeychainAccess
import Observation
import os

private let log = Logger(subsystem: Config.bundleID, category: "Auth")

/// Manages authentication state, token storage, and OAuth flows.
///
/// Uses Better Auth's session tokens as bearer tokens. The server-side middleware
/// injects the bearer token as a session cookie so Better Auth validates it normally.
/// Tokens are obtained via ASWebAuthenticationSession (GitHub / Apple OAuth).
/// The server's mobile callback bridge redirects to wingdex:// with the session token.
@Observable
final class AuthService: @unchecked Sendable {
    var isAuthenticated = false
    var userId: String?
    var userName: String?
    var userEmail: String?
    var userImage: String?

    private var sessionToken: String?
    private var sessionExpiry: Date?
    private let keychain = Keychain(service: Config.bundleID)

    private static let tokenKey = "session_token"
    private static let expiryKey = "session_expires_at"
    private static let userIdKey = "user_id"
    private static let userNameKey = "user_name"
    private static let userEmailKey = "user_email"

    init() {
        restoreSession()
        log.info("AuthService init - authenticated: \(self.isAuthenticated), userId: \(self.userId ?? "nil")")
    }

    // MARK: - OAuth Flows

    /// Sign in with GitHub via ASWebAuthenticationSession.
    @MainActor
    func signInWithGitHub() async throws {
        try await signInWithProvider("github")
    }

    /// Sign in with Apple using the native ASAuthorizationAppleIDProvider.
    /// Shows the system Face ID / Touch ID sheet - no web view needed.
    func signInWithApple(credential: ASAuthorizationAppleIDCredential) async throws {
        guard let identityTokenData = credential.identityToken,
              let identityToken = String(data: identityTokenData, encoding: .utf8)
        else {
            throw AuthError.oauthFailed("Missing Apple identity token")
        }

        // POST to Better Auth's sign-in/social endpoint with the Apple ID token.
        // Better Auth verifies the token with Apple, creates/links the account,
        // creates a session, and returns { token, user, redirect: false }.
        let url = Config.apiBaseURL.appendingPathComponent("api/auth/sign-in/social")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "provider": "apple",
            "idToken": ["token": identityToken],
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode)
        else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            let body = String(data: data, encoding: .utf8) ?? ""
            throw AuthError.oauthFailed("Apple sign-in failed (\(statusCode)): \(body)")
        }

        try processTokenResponse(data: data)
    }

    /// Sign in anonymously via Better Auth's anonymous plugin.
    /// Creates a temporary session - useful for local dev and demo-first UX.
    func signInAnonymously() async throws {
        log.info("Starting anonymous sign-in")
        let url = Config.apiBaseURL.appendingPathComponent("api/auth/sign-in/anonymous")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data("{}".utf8)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw AuthError.oauthFailed("Invalid response")
        }

        log.info("Anonymous sign-in response: \(httpResponse.statusCode)")

        guard (200...299).contains(httpResponse.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            log.error("Anonymous sign-in failed: \(httpResponse.statusCode) \(body)")
            throw AuthError.oauthFailed("Anonymous sign-in failed (\(httpResponse.statusCode))")
        }

        try processTokenResponse(data: data)
        log.info("Anonymous sign-in succeeded - userId: \(self.userId ?? "nil")")
    }

    /// Generic OAuth flow via ASWebAuthenticationSession.
    /// Opens Better Auth's sign-in URL with callbackURL pointed at our mobile bridge.
    @MainActor
    private func signInWithProvider(_ provider: String) async throws {
        log.info("Starting OAuth flow for provider: \(provider)")
        var components = URLComponents(url: Config.apiBaseURL.appendingPathComponent("api/auth/mobile/start"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "provider", value: provider),
        ]
        guard let signInURL = components.url else {
            throw AuthError.oauthFailed("Invalid sign-in URL")
        }

        log.debug("OAuth URL: \(signInURL)")
        let callbackURL = try await performWebAuth(url: signInURL)
        log.debug("OAuth callback received: \(callbackURL)")
        try processAuthCallback(url: callbackURL)
        log.info("OAuth sign-in succeeded for \(provider)")
    }

    /// Sign out - clear all state. Session invalidation happens server-side via expiry.
    func signOut() {
        log.info("Signing out")
        sessionToken = nil
        sessionExpiry = nil
        isAuthenticated = false
        userId = nil
        userName = nil
        userEmail = nil
        userImage = nil
        clearKeychain()
    }

    // MARK: - Passkey Flows

    /// Sign in with a passkey. Presents the system passkey sheet.
    func signInWithPasskey() async throws {
        log.info("Starting passkey sign-in")
        let service = PasskeyService()
        let result = try await service.authenticate()

        sessionToken = result.token
        sessionExpiry = result.expiresAt ?? Date.now.addingTimeInterval(7 * 24 * 60 * 60)
        userId = result.userId

        // Fetch full user info (name, email, image) using the new session
        try? await fetchUserInfo(token: result.token)

        isAuthenticated = true
        persistSession()
    }

    /// Register a new passkey for the current user.
    func registerPasskey(name: String) async throws {
        let token = try validToken()
        let service = PasskeyService()
        try await service.register(name: name, token: token)
    }

    /// List the current user's passkeys.
    func listPasskeys() async throws -> [PasskeyService.PasskeyInfo] {
        let token = try validToken()
        let service = PasskeyService()
        return try await service.listPasskeys(token: token)
    }

    /// Delete a passkey by ID.
    func deletePasskey(id: String) async throws {
        let token = try validToken()
        let service = PasskeyService()
        try await service.deletePasskey(id: id, token: token)
    }

    /// Fetch user info from Better Auth's get-session endpoint.
    private func fetchUserInfo(token: String) async throws {
        let url = Config.apiBaseURL.appendingPathComponent("api/auth/get-session")
        var request = URLRequest(url: url)
        request.setValue("better-auth.session_token=\(token)", forHTTPHeaderField: "Cookie")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200,
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let user = json["user"] as? [String: Any]
        else { return }

        userId = user["id"] as? String
        userName = user["name"] as? String
        userEmail = user["email"] as? String
        userImage = user["image"] as? String
    }

    /// Get a valid session token for API requests.
    /// Attach as `Authorization: Bearer <token>`.
    func validToken() throws -> String {
        guard let token = sessionToken,
              let expiry = sessionExpiry,
              expiry > Date.now
        else {
            signOut()
            throw AuthError.notAuthenticated
        }
        return token
    }

    // MARK: - ASWebAuthenticationSession

    @MainActor
    private func performWebAuth(url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: url,
                callback: .customScheme(Config.oauthCallbackScheme)
            ) { url, error in
                if let error {
                    continuation.resume(throwing: AuthError.oauthFailed(error.localizedDescription))
                } else if let url {
                    continuation.resume(returning: url)
                } else {
                    continuation.resume(throwing: AuthError.oauthFailed("No callback URL"))
                }
            }
            // Use non-ephemeral so OAuth cookies persist across the redirect chain
            session.prefersEphemeralWebBrowserSession = false
            session.start()
        }
    }

    // MARK: - Callback Processing

    /// Parse the wingdex://auth/callback?token=...&user_id=... redirect URL.
    private func processAuthCallback(url: URL) throws {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            throw AuthError.oauthFailed("Invalid callback URL")
        }

        let params = Dictionary(
            uniqueKeysWithValues: (components.queryItems ?? []).compactMap { item in
                item.value.map { (item.name, $0) }
            }
        )

        if let error = params["error"] {
            throw AuthError.oauthFailed(error)
        }

        guard let token = params["token"],
              let expiresAt = params["expires_at"]
        else {
            throw AuthError.oauthFailed("Missing token in callback")
        }

        let formatter = ISO8601DateFormatter()
        guard let expiry = formatter.date(from: expiresAt) else {
            throw AuthError.oauthFailed("Invalid expiry date")
        }

        sessionToken = token
        sessionExpiry = expiry
        userId = params["user_id"]
        userName = params["user_name"]
        userEmail = params["user_email"]
        userImage = params["user_image"]
        isAuthenticated = true

        persistSession()
    }

    /// Parse Better Auth's JSON response from sign-in/social with idToken.
    /// Response shape: { token: string, user: { id, name, email, image, ... } }
    private func processTokenResponse(data: Data) throws {
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = json["token"] as? String
        else {
            throw AuthError.oauthFailed("Invalid token response")
        }

        let user = json["user"] as? [String: Any]

        sessionToken = token
        // Better Auth sessions default to 7 days; use that as expiry
        sessionExpiry = Date.now.addingTimeInterval(7 * 24 * 60 * 60)
        userId = user?["id"] as? String
        userName = user?["name"] as? String
        userEmail = user?["email"] as? String
        userImage = user?["image"] as? String
        isAuthenticated = true

        persistSession()
    }

    // MARK: - Keychain Persistence

    private func persistSession() {
        keychain[Self.tokenKey] = sessionToken
        keychain[Self.expiryKey] = sessionExpiry?.ISO8601Format()
        keychain[Self.userIdKey] = userId
        keychain[Self.userNameKey] = userName
        keychain[Self.userEmailKey] = userEmail
    }

    private func restoreSession() {
        guard let token = keychain[Self.tokenKey],
              let expiryString = keychain[Self.expiryKey]
        else { return }

        let formatter = ISO8601DateFormatter()
        guard let expiry = formatter.date(from: expiryString),
              expiry > Date.now
        else {
            clearKeychain()
            return
        }

        sessionToken = token
        sessionExpiry = expiry
        userId = keychain[Self.userIdKey]
        userName = keychain[Self.userNameKey]
        userEmail = keychain[Self.userEmailKey]
        isAuthenticated = true
    }

    private func clearKeychain() {
        keychain[Self.tokenKey] = nil
        keychain[Self.expiryKey] = nil
        keychain[Self.userIdKey] = nil
        keychain[Self.userNameKey] = nil
        keychain[Self.userEmailKey] = nil
    }
}

enum AuthError: LocalizedError {
    case notAuthenticated
    case oauthFailed(String)

    var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            "Not authenticated"
        case .oauthFailed(let message):
            "Sign-in failed: \(message)"
        }
    }
}
