import AuthenticationServices
import Foundation
import KeychainAccess
import Observation
import UIKit
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
    @MainActor
    func signInWithAppleNative() async throws {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]

        let credential = try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<ASAuthorizationAppleIDCredential, Error>) in
            let handler = AppleSignInHandler(continuation: continuation)
            self.appleSignInHandler = handler
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = handler
            controller.performRequests()
        }

        self.appleSignInHandler = nil
        try await signInWithApple(credential: credential)
    }

    private var appleSignInHandler: AppleSignInHandler?

    /// Sign in with Apple using a pre-obtained credential.
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
        request.setValue(Config.apiBaseURL.absoluteString, forHTTPHeaderField: "Origin")

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

        try processTokenResponse(data: data, response: response)
    }

    /// Sign in anonymously via Better Auth's anonymous plugin.
    /// Creates a temporary session - useful for local dev and demo-first UX.
    func signInAnonymously() async throws {
        log.info("Starting anonymous sign-in")
        // Clear any stale session cookies so Better Auth doesn't reject
        // with "Anonymous users cannot sign in again anonymously".
        clearAPICookies()
        let url = Config.apiBaseURL.appendingPathComponent("api/auth/sign-in/anonymous")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(Config.apiBaseURL.absoluteString, forHTTPHeaderField: "Origin")
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

        try processTokenResponse(data: data, response: response)
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
        clearAPICookies()
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
            // Presentation context: use the first window scene's key window
            let contextProvider = WebAuthContextProvider()
            session.presentationContextProvider = contextProvider
            self.webAuthContext = contextProvider
            session.start()
        }
    }

    private var webAuthContext: WebAuthContextProvider?

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
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        // Try with fractional seconds first, then without
        let expiry = formatter.date(from: expiresAt) ?? {
            let basic = ISO8601DateFormatter()
            return basic.date(from: expiresAt)
        }()
        guard let expiry else {
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
    private func processTokenResponse(data: Data, response: URLResponse? = nil) throws {
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw AuthError.oauthFailed("Invalid token response")
        }

        // Prefer the full signed session token from Set-Cookie header,
        // which includes the HMAC signature Better Auth needs for validation.
        // Fallback to the raw "token" field from the JSON body.
        var token: String?
        if let httpResponse = response as? HTTPURLResponse,
           let cookies = httpResponse.value(forHTTPHeaderField: "Set-Cookie")
        {
            // Parse "better-auth.session_token=VALUE; ..." from Set-Cookie
            for part in cookies.components(separatedBy: ",") {
                let trimmed = part.trimmingCharacters(in: .whitespaces)
                if trimmed.contains("session_token=") {
                    if let range = trimmed.range(of: "session_token=") {
                        let afterEquals = trimmed[range.upperBound...]
                        let tokenValue = String(afterEquals.prefix(while: { $0 != ";" }))
                        if !tokenValue.isEmpty {
                            token = tokenValue.removingPercentEncoding ?? tokenValue
                        }
                    }
                }
            }
        }
        if token == nil {
            token = json["token"] as? String
        }
        guard let resolvedToken = token else {
            throw AuthError.oauthFailed("No session token in response")
        }

        let user = json["user"] as? [String: Any]

        self.sessionToken = resolvedToken
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

    /// Remove cookies for the API domain so URLSession doesn't send stale session cookies.
    private func clearAPICookies() {
        guard let cookies = HTTPCookieStorage.shared.cookies(for: Config.apiBaseURL) else { return }
        for cookie in cookies {
            HTTPCookieStorage.shared.deleteCookie(cookie)
        }
    }
}

/// Provides the presentation anchor for ASWebAuthenticationSession.
private final class WebAuthContextProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene
        return scene?.keyWindow ?? UIWindow(frame: .zero)
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

// MARK: - Apple Sign-In Delegate

/// Bridges the delegate-based ASAuthorizationController flow into async/await
/// via CheckedContinuation. Retained by AuthService until the flow completes.
private final class AppleSignInHandler: NSObject, ASAuthorizationControllerDelegate, @unchecked Sendable {
    private var continuation: CheckedContinuation<ASAuthorizationAppleIDCredential, Error>?

    init(continuation: CheckedContinuation<ASAuthorizationAppleIDCredential, Error>) {
        self.continuation = continuation
    }

    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
            continuation?.resume(throwing: AuthError.oauthFailed("Unexpected credential type"))
            continuation = nil
            return
        }
        continuation?.resume(returning: credential)
        continuation = nil
    }

    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        continuation?.resume(throwing: error)
        continuation = nil
    }
}
