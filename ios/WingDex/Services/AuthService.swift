import AuthenticationServices
import Foundation
import KeychainAccess
import Observation
import UIKit
import os

private let log = Logger(subsystem: Config.bundleID, category: "Auth")

/// Manages authentication state, token storage, and OAuth flows.
///
/// Uses Better Auth's raw session token for bearer auth and the signed session token
/// for Better Auth's passkey endpoints that still validate cookie-based sessions.
/// Tokens are obtained via ASWebAuthenticationSession (GitHub / Apple OAuth).
/// The server's mobile callback bridge redirects to wingdex:// with the session token.
@MainActor @Observable
final class AuthService: @unchecked Sendable {
    var isAuthenticated = false
    var userId: String?
    var userName: String?
    var userEmail: String?
    var userImage: String?

    private var sessionToken: String?
    /// Signed session token (includes HMAC suffix) for cookie-based auth.
    /// Needed by passkey plugin endpoints which use internal cookie validation.
    private(set) var signedSessionToken: String?
    private var sessionExpiry: Date?
    private let keychain = Keychain(service: Config.bundleID)
        .accessibility(.whenUnlockedThisDeviceOnly)

    /// Ephemeral session that never sends or stores cookies.
    /// Prevents stale cookies from conflicting with Bearer token auth.
    private static let bearerSession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieAcceptPolicy = .never
        config.httpShouldSetCookies = false
        return URLSession(configuration: config)
    }()

    private static let tokenKey = "session_token"
    private static let signedTokenKey = "signed_session_token"
    private static let expiryKey = "session_expires_at"
    private static let userIdKey = "user_id"
    private static let userNameKey = "user_name"
    private static let userEmailKey = "user_email"
    private static let userImageKey = "user_image"

    init() {
        restoreSession()
        log.info("AuthService init - authenticated: \(self.isAuthenticated), userId: \(self.userId ?? "nil")")
    }

    /// Validate the locally-cached session with the server.
    /// Signs out on 401 (expired/revoked session) so the UI goes straight to
    /// sign-in instead of flashing authenticated content. Network errors are
    /// ignored - the user may be offline with a valid cached session.
    func validateSession() async {
        guard let token = sessionToken else { return }
        let url = Config.apiBaseURL.appendingPathComponent("api/auth/get-session")
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 5
        do {
            let (_, response) = try await Self.bearerSession.data(for: request)
            if let http = response as? HTTPURLResponse, http.statusCode == 401 {
                log.warning("Session rejected by server, signing out")
                signOut()
            }
        } catch {
            // Network error - don't sign out, user may be offline
            log.info("Session validation skipped: \(error.localizedDescription)")
        }
    }

    // MARK: - OAuth Flows

    /// Sign in with GitHub via ASWebAuthenticationSession.
    func signInWithGitHub() async throws {
        try await signInWithProvider("github")
    }

    /// Sign in with Google via ASWebAuthenticationSession.
    func signInWithGoogle() async throws {
        try await signInWithProvider("google")
    }

    /// Sign in with Apple using the native ASAuthorizationAppleIDProvider.
    /// Shows the system Face ID / Touch ID sheet - no web view needed.
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
        signedSessionToken = nil
        sessionExpiry = nil
        isAuthenticated = false
        userId = nil
        userName = nil
        userEmail = nil
        userImage = nil
        clearKeychain()
        clearAPICookies()
    }

    // MARK: - Profile Updates

    /// Send name and image to Better Auth's update-user endpoint and persist on success.
    func updateProfile(name: String, image: String) async throws {
        let token = try validToken()
        let url = Config.apiBaseURL.appendingPathComponent("api/auth/update-user")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(Config.apiBaseURL.absoluteString, forHTTPHeaderField: "Origin")

        let body: [String: String] = ["name": name.trimmingCharacters(in: .whitespacesAndNewlines), "image": image]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await Self.bearerSession.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            let detail = String(data: data, encoding: .utf8) ?? ""
            throw AuthError.oauthFailed("Profile update failed (\(statusCode)): \(detail)")
        }

        // Update in-memory state and persist to Keychain.
        // The caller (ProfileEditor) also sets these optimistically
        // before the network call, so this ensures they stay in sync.
        userName = name
        userImage = image
        persistSession()
    }

    /// Delete the user's account via Better Auth's delete-user endpoint.
    func deleteAccount() async throws {
        let token = try validToken()
        let url = Config.apiBaseURL.appendingPathComponent("api/auth/delete-user")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(Config.apiBaseURL.absoluteString, forHTTPHeaderField: "Origin")
        request.httpBody = Data("{}".utf8)

        let (data, response) = try await Self.bearerSession.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            let detail = String(data: data, encoding: .utf8) ?? ""
            throw AuthError.oauthFailed("Account deletion failed (\(statusCode)): \(detail)")
        }

        signOut()
    }

    // MARK: - Passkey Flows

    /// Sign in with a passkey. Presents the system passkey sheet.
    func signInWithPasskey() async throws {
        log.info("Starting passkey sign-in")
        let service = PasskeyService()
        let result = try await service.authenticate()

        sessionToken = result.token
        signedSessionToken = result.signedToken
        sessionExpiry = result.expiresAt ?? Date.now.addingTimeInterval(7 * 24 * 60 * 60)
        userId = result.userId

        // Fetch full user info (name, email, image) using the new session
        try? await fetchUserInfo(token: result.token)

        isAuthenticated = true
        persistSession()
    }

    /// Sign up with a passkey: create anonymous session, register passkey, finalize.
    /// Does NOT set isAuthenticated until the full flow succeeds, so the sign-in
    /// screen stays visible throughout.
    func signUpWithPasskey() async throws {
        log.info("Starting passkey sign-up flow")

        // 0. Clean slate - clear any stale session
        clearAPICookies()
        clearKeychain()
        sessionToken = nil
        signedSessionToken = nil
        sessionExpiry = nil
        userId = nil

        // 1. Create anonymous session (without setting isAuthenticated)
        let anonURL = Config.apiBaseURL.appendingPathComponent("api/auth/sign-in/anonymous")
        var anonRequest = URLRequest(url: anonURL)
        anonRequest.httpMethod = "POST"
        anonRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        anonRequest.setValue(Config.apiBaseURL.absoluteString, forHTTPHeaderField: "Origin")
        anonRequest.httpBody = Data("{}".utf8)

        let (anonData, anonResponse) = try await URLSession.shared.data(for: anonRequest)
        guard let anonHttp = anonResponse as? HTTPURLResponse,
              (200...299).contains(anonHttp.statusCode),
              let anonJson = try JSONSerialization.jsonObject(with: anonData) as? [String: Any],
              let rawToken = anonJson["token"] as? String
        else {
            throw AuthError.oauthFailed("Failed to create account")
        }

        // Capture signed token from header for cookie auth
        let signedToken = anonHttp.value(forHTTPHeaderField: "set-auth-token")
        sessionToken = rawToken
        signedSessionToken = signedToken
        sessionExpiry = Date.now.addingTimeInterval(7 * 24 * 60 * 60)
        let user = anonJson["user"] as? [String: Any]
        userId = user?["id"] as? String

        log.info("Anonymous session created for sign-up - userId: \(self.userId ?? "nil")")

        // 2. Fetch full user info to ensure signed token is set
        if signedSessionToken == nil {
            try? await fetchUserInfo(token: rawToken)
        }

        guard let signed = signedSessionToken else {
            throw AuthError.oauthFailed("Missing session token for passkey registration")
        }

        // 3. Register a passkey (override Keychain username with bird name)
        let birdName = FunNames.generateBirdName()
        let deviceModel = UIDevice.current.model
        let passkeyName = "\(deviceModel) (\(birdName))"
        let service = PasskeyService()
        try await service.register(name: passkeyName, signedToken: signed, displayName: birdName)

        // 4. Finalize: promote anonymous user to real user (cookie auth like web)
        let finalizeURL = Config.apiBaseURL.appendingPathComponent("api/auth/finalize-passkey")
        let finalizeRequest = AuthenticatedRequest.withCookieOnly(
            url: finalizeURL,
            signedToken: signed,
            method: "POST",
            body: try JSONSerialization.data(withJSONObject: ["name": birdName]),
            contentType: "application/json"
        )

        let (_, finalizeResponse) = try await URLSession.shared.data(for: finalizeRequest)
        guard let finalizeHttp = finalizeResponse as? HTTPURLResponse,
              (200...299).contains(finalizeHttp.statusCode)
        else {
            let status = (finalizeResponse as? HTTPURLResponse)?.statusCode ?? -1
            log.error("Finalize failed: HTTP \(status)")
            throw AuthError.oauthFailed("Account setup failed")
        }

        // 5. Clear ALL cookies before any Bearer-authenticated requests.
        // The finalize response sets new cookies that URLSession would
        // auto-send alongside Bearer headers, causing 401 conflicts.
        clearAPICookies()

        // 6. Success - set authenticated and persist
        let emoji = FunNames.emojiForBirdName(birdName)
        let avatarDataUrl = FunNames.emojiAvatarDataUrl(emoji)
        userName = birdName
        userImage = avatarDataUrl
        isAuthenticated = true
        persistSession()

        log.info("Passkey sign-up succeeded - \(birdName)")

        // 7. Push avatar to server in background (off critical path).
        // This runs after isAuthenticated is set and DataStore.fetchAll
        // has started, so it won't interfere with the initial data load.
        Task.detached { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            guard let self else { return }
            await MainActor.run { self.clearAPICookies() }
            try? await self.updateProfile(name: birdName, image: avatarDataUrl)
            await MainActor.run { self.clearAPICookies() }
        }
    }

    /// Register a new passkey for the current user.
    func registerPasskey(name: String) async throws {
        let token = try validToken()
        // Ensure we have the signed token for passkey cookie auth
        if signedSessionToken == nil {
            try? await fetchUserInfo(token: token)
        }
        let service = PasskeyService()
        try await service.register(name: name, signedToken: signedSessionToken)
    }

    /// List the current user's passkeys.
    func listPasskeys() async throws -> [PasskeyService.PasskeyInfo] {
        let token = try validToken()
        if signedSessionToken == nil {
            try? await fetchUserInfo(token: token)
        }
        guard let signedToken = signedSessionToken else {
            throw AuthError.notAuthenticated
        }
        let service = PasskeyService()
        return try await service.listPasskeys(signedToken: signedToken)
    }

    /// Delete a passkey by ID.
    func deletePasskey(id: String) async throws {
        let token = try validToken()
        if signedSessionToken == nil {
            try? await fetchUserInfo(token: token)
        }
        guard let signedToken = signedSessionToken else {
            throw AuthError.notAuthenticated
        }
        let service = PasskeyService()
        try await service.deletePasskey(id: id, signedToken: signedToken)
    }

    /// Fetch user info from Better Auth's get-session endpoint.
    /// Uses Bearer token auth via the bearer() plugin.
    /// Also captures the signed session token for passkey endpoint cookies.
    private func fetchUserInfo(token: String) async throws {
        let url = Config.apiBaseURL.appendingPathComponent("api/auth/get-session")
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await Self.bearerSession.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200,
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let user = json["user"] as? [String: Any]
        else { return }

        userId = user["id"] as? String
        userName = user["name"] as? String
        userEmail = user["email"] as? String
        userImage = user["image"] as? String

        // Capture signed token for passkey cookie auth
        if let signed = httpResponse.value(forHTTPHeaderField: "set-auth-token") {
            signedSessionToken = signed
            keychain[Self.signedTokenKey] = signed
        }
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

    /// Parsed result from an OAuth callback URL.
    struct CallbackResult {
        let token: String
        let signedToken: String?
        let expiry: Date
        let userId: String?
        let userName: String?
        let userEmail: String?
        let userImage: String?
    }

    /// Parse the wingdex://auth/callback?token=...&user_id=... redirect URL.
    /// Extracted as a static method for testability.
    nonisolated static func parseCallbackURL(_ url: URL) throws -> CallbackResult {
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

        guard let expiry = Self.parseISO8601(expiresAt) else {
            throw AuthError.oauthFailed("Invalid expiry date")
        }

        return CallbackResult(
            token: token,
            signedToken: params["signed_token"],
            expiry: expiry,
            userId: params["user_id"],
            userName: params["user_name"],
            userEmail: params["user_email"],
            userImage: params["user_image"]
        )
    }

    /// Parse an ISO 8601 date string, trying with fractional seconds first.
    nonisolated static func parseISO8601(_ string: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: string) { return date }
        let basic = ISO8601DateFormatter()
        return basic.date(from: string)
    }

    private func processAuthCallback(url: URL) throws {
        log.info("Processing callback (\(url.host ?? "?"))")
        let result = try Self.parseCallbackURL(url)
        log.info("Got token (\(result.token.count) chars)")

        sessionToken = result.token
        signedSessionToken = result.signedToken
        sessionExpiry = result.expiry
        userId = result.userId
        userName = result.userName
        userEmail = result.userEmail
        userImage = result.userImage
        isAuthenticated = true

        persistSession()
        clearAPICookies()
    }

    /// Parse Better Auth's JSON response from sign-in/social with idToken.
    /// Response shape: { token: string, user: { id, name, email, image, ... } }
    ///
    /// With the bearer() plugin, the server also sets a `set-auth-token` response
    /// header containing the session token. We prefer that, falling back to the
    /// raw `token` field from the JSON body.
    private func processTokenResponse(data: Data, response: URLResponse? = nil) throws {
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw AuthError.oauthFailed("Invalid token response")
        }

        // Raw token from JSON body - used for Bearer auth
        guard let rawToken = json["token"] as? String else {
            throw AuthError.oauthFailed("No session token in response")
        }

        // Signed token from set-auth-token header - used for cookie auth on passkey endpoints
        if let httpResponse = response as? HTTPURLResponse,
           let signed = httpResponse.value(forHTTPHeaderField: "set-auth-token") {
            signedSessionToken = signed
        }

        let user = json["user"] as? [String: Any]

        self.sessionToken = rawToken
        // Better Auth sessions default to 7 days; use that as expiry
        sessionExpiry = Date.now.addingTimeInterval(7 * 24 * 60 * 60)
        userId = user?["id"] as? String
        userName = user?["name"] as? String
        userEmail = user?["email"] as? String
        userImage = user?["image"] as? String
        isAuthenticated = true

        persistSession()
        // Clear cookies set by sign-in so URLSession doesn't send them
        // alongside Bearer headers on subsequent API requests.
        clearAPICookies()
    }

    // MARK: - Keychain Persistence

    private func persistSession() {
        keychain[Self.tokenKey] = sessionToken
        keychain[Self.signedTokenKey] = signedSessionToken
        keychain[Self.expiryKey] = sessionExpiry?.ISO8601Format()
        keychain[Self.userIdKey] = userId
        keychain[Self.userNameKey] = userName
        keychain[Self.userEmailKey] = userEmail
        keychain[Self.userImageKey] = userImage
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
        signedSessionToken = keychain[Self.signedTokenKey]
        sessionExpiry = expiry
        userId = keychain[Self.userIdKey]
        userName = keychain[Self.userNameKey]
        userEmail = keychain[Self.userEmailKey]
        userImage = keychain[Self.userImageKey]
        isAuthenticated = true

        // Clear stale cookies so URLSession doesn't send them alongside
        // the Bearer header. Stale cookies can cause 401 if Better Auth
        // checks them before the Bearer token.
        clearAPICookies()
    }

    private func clearKeychain() {
        keychain[Self.tokenKey] = nil
        keychain[Self.signedTokenKey] = nil
        keychain[Self.expiryKey] = nil
        keychain[Self.userIdKey] = nil
        keychain[Self.userNameKey] = nil
        keychain[Self.userEmailKey] = nil
        keychain[Self.userImageKey] = nil
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
        // Force-unwrap: a UIWindowScene always exists when the user triggers auth.
        let scene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene }).first!
        return scene.keyWindow ?? UIWindow(windowScene: scene)
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
            "Log in failed: \(message)"
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
