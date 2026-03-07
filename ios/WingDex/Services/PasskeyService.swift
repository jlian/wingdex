import AuthenticationServices
import Foundation
import os
import UIKit

private let log = Logger(subsystem: Config.bundleID, category: "Passkey")

/// Handles WebAuthn passkey operations against Better Auth's passkey plugin.
///
/// The two-step challenge flow (generate-options then verify) uses a signed cookie
/// to bind the challenge. This service manually extracts that cookie from the first
/// response and forwards it to the verification request so we don't depend on
/// URLSession's automatic cookie storage.
///
/// For authenticated endpoints (registration, list, delete) the session token is
/// sent as an `Authorization: Bearer` header, validated by Better Auth's bearer plugin.
final class PasskeyService: NSObject, @unchecked Sendable {

    // MARK: - Public Types

    struct AuthResult {
        let token: String
        let userId: String
        let expiresAt: Date?
    }

    struct PasskeyInfo: Decodable, Identifiable {
        let id: String
        let name: String?
        let credentialID: String
        let createdAt: String
    }

    // MARK: - Authentication (Sign In)

    /// Perform a full passkey authentication:
    /// 1. Fetch challenge options from the server
    /// 2. Present the system passkey sheet
    /// 3. Verify the assertion with the server
    /// Returns a session token on success.
    func authenticate() async throws -> AuthResult {
        // Step 1 - Fetch authentication options
        let optionsURL = Config.apiBaseURL.appendingPathComponent("api/auth/passkey/generate-authenticate-options")
        var optionsRequest = URLRequest(url: optionsURL)
        optionsRequest.setValue(Config.apiBaseURL.absoluteString, forHTTPHeaderField: "Origin")

        let (optionsData, optionsResponse) = try await URLSession.shared.data(for: optionsRequest)

        guard let httpResponse = optionsResponse as? HTTPURLResponse,
              httpResponse.statusCode == 200
        else {
            throw PasskeyError.serverError("Failed to get authentication options")
        }

        let challengeCookieHeader = extractCookieHeader(from: httpResponse, for: optionsURL)
        let options = try JSONDecoder().decode(AuthenticationOptions.self, from: optionsData)

        guard let challengeData = Data(base64URLEncoded: options.challenge) else {
            throw PasskeyError.invalidChallenge
        }

        // Step 2 - Platform passkey assertion
        let assertion = try await performAssertion(
            challenge: challengeData,
            rpId: Config.rpID,
            allowCredentials: options.allowCredentials
        )

        // Step 3 - Verify assertion with server
        let verifyURL = Config.apiBaseURL.appendingPathComponent("api/auth/passkey/verify-authentication")
        var verifyRequest = URLRequest(url: verifyURL)
        verifyRequest.httpMethod = "POST"
        verifyRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        verifyRequest.setValue(Config.apiBaseURL.absoluteString, forHTTPHeaderField: "Origin")
        if let cookies = challengeCookieHeader {
            verifyRequest.setValue(cookies, forHTTPHeaderField: "Cookie")
        }

        let credentialID = assertion.credentialID.base64URLEncodedString()
        let body: [String: Any] = [
            "response": [
                "id": credentialID,
                "rawId": credentialID,
                "type": "public-key",
                "response": [
                    "clientDataJSON": assertion.rawClientDataJSON.base64URLEncodedString(),
                    "authenticatorData": assertion.rawAuthenticatorData.base64URLEncodedString(),
                    "signature": assertion.signature.base64URLEncodedString(),
                    "userHandle": assertion.userID.base64URLEncodedString(),
                ] as [String: Any],
                "authenticatorAttachment": "platform",
                "clientExtensionResults": [String: Any](),
            ] as [String: Any],
        ]
        verifyRequest.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (verifyData, verifyResponse) = try await URLSession.shared.data(for: verifyRequest)

        guard let verifyHttp = verifyResponse as? HTTPURLResponse,
              verifyHttp.statusCode == 200
        else {
            throw PasskeyError.authenticationFailed
        }

        // Response shape: { session: { token, userId, expiresAt, ... } }
        guard let json = try JSONSerialization.jsonObject(with: verifyData) as? [String: Any],
              let session = json["session"] as? [String: Any],
              let userId = session["userId"] as? String
        else {
            throw PasskeyError.invalidResponse
        }

        // Prefer set-auth-token header (provided by bearer plugin), fall back to raw JSON token
        var token: String?
        if let authToken = verifyHttp.value(forHTTPHeaderField: "set-auth-token") {
            token = authToken
        }
        if token == nil {
            token = session["token"] as? String
        }
        guard let resolvedToken = token else {
            throw PasskeyError.invalidResponse
        }

        var expiresAt: Date?
        if let expiresAtString = session["expiresAt"] as? String {
            expiresAt = ISO8601DateFormatter().date(from: expiresAtString)
        }

        return AuthResult(token: resolvedToken, userId: userId, expiresAt: expiresAt)
    }

    // MARK: - Registration (Add Passkey)

    /// Register a new passkey for the currently authenticated user.
    /// Requires a valid session token.
    func register(name: String, token: String) async throws {
        // Step 1 - Fetch registration options
        var components = URLComponents(
            url: Config.apiBaseURL.appendingPathComponent("api/auth/passkey/generate-register-options"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [
            URLQueryItem(name: "authenticatorAttachment", value: "platform"),
        ]
        let optionsURL = components.url!

        var optionsRequest = URLRequest(url: optionsURL)
        optionsRequest.setValue(Config.apiBaseURL.absoluteString, forHTTPHeaderField: "Origin")
        optionsRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        optionsRequest.setValue(sessionCookies(token: token), forHTTPHeaderField: "Cookie")

        let (optionsData, optionsResponse) = try await URLSession.shared.data(for: optionsRequest)

        guard let httpResponse = optionsResponse as? HTTPURLResponse,
              httpResponse.statusCode == 200
        else {
            let status = (optionsResponse as? HTTPURLResponse)?.statusCode ?? -1
            log.error("Registration options failed: HTTP \(status)")
            throw PasskeyError.serverError("Failed to get registration options (HTTP \(status))")
        }

        let challengeCookieHeader = self.extractCookieHeader(from: httpResponse, for: optionsURL)
        log.info("Registration options received, challenge cookie present: \(challengeCookieHeader != nil)")
        let options = try JSONDecoder().decode(RegistrationOptions.self, from: optionsData)

        guard let challengeData = Data(base64URLEncoded: options.challenge) else {
            throw PasskeyError.invalidChallenge
        }
        guard let userIDData = Data(base64URLEncoded: options.user.id) else {
            throw PasskeyError.invalidChallenge
        }

        // Step 2 - Platform passkey registration
        let registration = try await performRegistration(
            challenge: challengeData,
            rpId: options.rp.id,
            userName: options.user.name,
            userID: userIDData
        )

        // Step 3 - Verify registration with server
        let verifyURL = Config.apiBaseURL.appendingPathComponent("api/auth/passkey/verify-registration")
        var verifyRequest = URLRequest(url: verifyURL)
        verifyRequest.httpMethod = "POST"
        verifyRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        verifyRequest.setValue(Config.apiBaseURL.absoluteString, forHTTPHeaderField: "Origin")

        // Send session token as Bearer + cookie (passkey plugin needs cookie for internal session)
        // plus challenge cookies from step 1
        verifyRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        var cookieParts = [sessionCookies(token: token)]
        if let challengeCookies = challengeCookieHeader {
            cookieParts.append(challengeCookies)
            log.debug("Forwarding challenge cookies to verify")
        } else {
            log.warning("No challenge cookies to forward to verify")
        }
        verifyRequest.setValue(cookieParts.joined(separator: "; "), forHTTPHeaderField: "Cookie")

        let credentialID = registration.credentialID.base64URLEncodedString()
        let registrationBody: [String: Any] = [
            "response": [
                "id": credentialID,
                "rawId": credentialID,
                "type": "public-key",
                "response": [
                    "clientDataJSON": registration.rawClientDataJSON.base64URLEncodedString(),
                    "attestationObject": (registration.rawAttestationObject ?? Data()).base64URLEncodedString(),
                    "transports": ["internal"],
                ] as [String: Any],
                "authenticatorAttachment": "platform",
                "clientExtensionResults": [String: Any](),
            ] as [String: Any],
            "name": name,
        ]
        verifyRequest.httpBody = try JSONSerialization.data(withJSONObject: registrationBody)

        let (_, verifyResponse) = try await URLSession.shared.data(for: verifyRequest)

        guard let verifyHttp = verifyResponse as? HTTPURLResponse,
              verifyHttp.statusCode == 200
        else {
            let status = (verifyResponse as? HTTPURLResponse)?.statusCode ?? -1
            log.error("Registration verify failed: HTTP \(status)")
            throw PasskeyError.registrationFailed
        }
        log.info("Passkey registration succeeded")
    }

    // MARK: - List Passkeys

    func listPasskeys(token: String) async throws -> [PasskeyInfo] {
        let url = Config.apiBaseURL.appendingPathComponent("api/auth/passkey/list-user-passkeys")
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(sessionCookies(token: token), forHTTPHeaderField: "Cookie")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200
        else {
            throw PasskeyError.serverError("Failed to list passkeys")
        }

        return try JSONDecoder().decode([PasskeyInfo].self, from: data)
    }

    // MARK: - Delete Passkey

    func deletePasskey(id: String, token: String) async throws {
        let url = Config.apiBaseURL.appendingPathComponent("api/auth/passkey/delete-passkey")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(sessionCookies(token: token), forHTTPHeaderField: "Cookie")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["id": id])

        let (_, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200
        else {
            throw PasskeyError.serverError("Failed to delete passkey")
        }
    }

    // MARK: - ASAuthorizationController Bridge

    private var authContinuation: CheckedContinuation<ASAuthorization, Error>?
    private var activeController: ASAuthorizationController?
    // Prevent premature deallocation while the authorization sheet is shown.
    // ASAuthorizationController holds its delegate weakly.
    private var selfRetain: PasskeyService?

    @MainActor
    private func performAssertion(
        challenge: Data,
        rpId: String,
        allowCredentials: [WebAuthnCredential]?
    ) async throws -> ASAuthorizationPlatformPublicKeyCredentialAssertion {
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpId)
        let request = provider.createCredentialAssertionRequest(challenge: challenge)

        if let allowCredentials {
            request.allowedCredentials = allowCredentials.compactMap { cred in
                guard let idData = Data(base64URLEncoded: cred.id) else { return nil }
                return ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: idData)
            }
        }

        let authorization = try await requestAuthorization(requests: [request])

        guard let assertion = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion else {
            throw PasskeyError.unexpectedCredentialType
        }
        return assertion
    }

    @MainActor
    private func performRegistration(
        challenge: Data,
        rpId: String,
        userName: String,
        userID: Data
    ) async throws -> ASAuthorizationPlatformPublicKeyCredentialRegistration {
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpId)
        let request = provider.createCredentialRegistrationRequest(
            challenge: challenge,
            name: userName,
            userID: userID
        )

        let authorization = try await requestAuthorization(requests: [request])

        guard let registration = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration else {
            throw PasskeyError.unexpectedCredentialType
        }
        return registration
    }

    @MainActor
    private func requestAuthorization(requests: [ASAuthorizationRequest]) async throws -> ASAuthorization {
        try await withCheckedThrowingContinuation { continuation in
            self.selfRetain = self
            self.authContinuation = continuation
            let controller = ASAuthorizationController(authorizationRequests: requests)
            self.activeController = controller
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    // MARK: - Cookie Helpers

    /// Extract Set-Cookie values from a response as a single Cookie header string.
    private func extractCookieHeader(from response: HTTPURLResponse, for url: URL) -> String? {
        guard let headerFields = response.allHeaderFields as? [String: String] else { return nil }
        let cookies = HTTPCookie.cookies(withResponseHeaderFields: headerFields, for: url)
        guard !cookies.isEmpty else { return nil }
        return cookies.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
    }

    /// Build session cookie string for Better Auth internal endpoints.
    /// The bearer plugin handles getSession, but Better Auth's passkey
    /// endpoints use their own internal session validation via cookies.
    /// We send both prefixed and non-prefixed variants for HTTP/HTTPS compat.
    private func sessionCookies(token: String) -> String {
        "better-auth.session_token=\(token); __Secure-better-auth.session_token=\(token)"
    }

    // MARK: - Decodable Models

    private struct AuthenticationOptions: Decodable {
        let challenge: String
        let allowCredentials: [WebAuthnCredential]?
    }

    private struct RegistrationOptions: Decodable {
        let challenge: String
        let rp: RP
        let user: User

        struct RP: Decodable {
            let name: String
            let id: String
        }

        struct User: Decodable {
            let id: String
            let name: String
            let displayName: String
        }
    }

    struct WebAuthnCredential: Decodable {
        let id: String
        let type: String?
        let transports: [String]?
    }
}

// MARK: - ASAuthorizationControllerDelegate

extension PasskeyService: ASAuthorizationControllerDelegate {
    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        authContinuation?.resume(returning: authorization)
        authContinuation = nil
        activeController = nil
        selfRetain = nil
    }

    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        authContinuation?.resume(throwing: error)
        authContinuation = nil
        activeController = nil
        selfRetain = nil
    }
}

// MARK: - ASAuthorizationControllerPresentationContextProviding

extension PasskeyService: ASAuthorizationControllerPresentationContextProviding {
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        let scene = UIApplication.shared.connectedScenes.first as! UIWindowScene
        return scene.keyWindow ?? UIWindow(windowScene: scene)
    }
}

// MARK: - Errors

enum PasskeyError: LocalizedError {
    case serverError(String)
    case invalidChallenge
    case invalidResponse
    case authenticationFailed
    case registrationFailed
    case unexpectedCredentialType

    var errorDescription: String? {
        switch self {
        case .serverError(let message): message
        case .invalidChallenge: "Invalid challenge from server"
        case .invalidResponse: "Invalid response from server"
        case .authenticationFailed: "Passkey authentication failed"
        case .registrationFailed: "Passkey registration failed"
        case .unexpectedCredentialType: "Unexpected credential type"
        }
    }
}
