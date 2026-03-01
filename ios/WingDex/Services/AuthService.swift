import AuthenticationServices
import Foundation
import Observation

/// Manages authentication state, token storage, and OAuth flows.
///
/// Uses short-lived bearer tokens (JWT, ~15 min) with refresh token rotation.
/// Tokens are obtained via ASWebAuthenticationSession (GitHub OAuth) or
/// native ASAuthorizationAppleIDProvider (Apple Sign-In).
@Observable
final class AuthService {
    var isAuthenticated = false
    var userName: String?
    var userEmail: String?

    /// In-memory access token (short-lived, not persisted).
    private var accessToken: String?
    private var accessTokenExpiry: Date?

    // MARK: - Public API

    /// Sign in with GitHub via ASWebAuthenticationSession.
    func signInWithGitHub() async throws {
        // TODO: Build Better Auth GitHub OAuth URL
        // TODO: Open ASWebAuthenticationSession
        // TODO: Exchange callback code for token pair via POST /api/auth/token
        // TODO: Store refresh token in Keychain, access token in memory
    }

    /// Sign in with Apple using native ASAuthorizationAppleIDProvider.
    func signInWithApple(authorization: ASAuthorization) async throws {
        // TODO: Extract Apple ID token from ASAuthorizationAppleIDCredential
        // TODO: POST to /api/auth/token with grant_type=apple
        // TODO: Store refresh token in Keychain, access token in memory
    }

    /// Sign in with passkey.
    func signInWithPasskey(assertion: ASAuthorizationPlatformPublicKeyCredentialAssertion) async throws {
        // TODO: Send assertion to Better Auth passkey endpoint
        // TODO: Exchange for token pair
    }

    /// Sign out - revoke refresh token and clear all state.
    func signOut() async {
        // TODO: POST /api/auth/token/revoke with refresh token
        // TODO: Clear Keychain
        accessToken = nil
        accessTokenExpiry = nil
        isAuthenticated = false
        userName = nil
        userEmail = nil
    }

    /// Get a valid access token, refreshing if expired.
    /// Attach this to API requests as `Authorization: Bearer <token>`.
    func validAccessToken() async throws -> String {
        // Return existing token if still valid
        if let token = accessToken, let expiry = accessTokenExpiry, expiry > Date.now {
            return token
        }

        // TODO: Refresh via POST /api/auth/token/refresh
        // TODO: If refresh fails, set isAuthenticated = false and throw
        throw AuthError.notAuthenticated
    }

    // MARK: - Keychain

    private func storeRefreshToken(_ token: String) {
        // TODO: Store in Keychain using KeychainAccess
    }

    private func loadRefreshToken() -> String? {
        // TODO: Load from Keychain
        nil
    }

    private func clearRefreshToken() {
        // TODO: Clear from Keychain
    }
}

enum AuthError: LocalizedError {
    case notAuthenticated
    case tokenRefreshFailed
    case oauthFailed(String)

    var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            "Not authenticated"
        case .tokenRefreshFailed:
            "Failed to refresh authentication"
        case .oauthFailed(let message):
            "OAuth failed: \(message)"
        }
    }
}
