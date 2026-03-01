import AuthenticationServices
import Foundation
import KeychainAccess
import Observation

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

    /// Generic OAuth flow via ASWebAuthenticationSession.
    /// Opens Better Auth's sign-in URL with callbackURL pointed at our mobile bridge.
    @MainActor
    private func signInWithProvider(_ provider: String) async throws {
        var components = URLComponents(url: Config.apiBaseURL.appendingPathComponent("api/auth/signin/\(provider)"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "callbackURL", value: "/api/auth/mobile/callback"),
        ]
        guard let signInURL = components.url else {
            throw AuthError.oauthFailed("Invalid sign-in URL")
        }

        let callbackURL = try await performWebAuth(url: signInURL)
        try processAuthCallback(url: callbackURL)
    }

    /// Sign out - clear all state. Session invalidation happens server-side via expiry.
    func signOut() {
        sessionToken = nil
        sessionExpiry = nil
        isAuthenticated = false
        userId = nil
        userName = nil
        userEmail = nil
        userImage = nil
        clearKeychain()
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
