import Foundation
import os

private let log = Logger(subsystem: Config.bundleID, category: "API")

/// Centralized helper for building authenticated API requests.
///
/// Better Auth has two auth mechanisms:
/// - **Bearer token**: Used by the `bearer()` plugin for middleware-protected routes
///   (`/api/data/*`) and some auth endpoints (`get-session`, `list-user-passkeys`).
///   Accepts the raw session token.
/// - **Session cookie**: Used by Better Auth's internal plugin endpoints (passkey
///   verify, registration verify) which do their own cookie-based session validation.
///   Requires the HMAC-signed session token as a cookie value.
///
/// This helper encapsulates both patterns so callers don't need to know which to use.
enum AuthenticatedRequest {

    /// Build a request with Bearer token auth (for middleware-protected routes).
    static func withBearer(
        url: URL,
        token: String,
        method: String = "GET",
        body: Data? = nil,
        contentType: String? = nil
    ) -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(Config.apiBaseURL.absoluteString, forHTTPHeaderField: "Origin")
        if let contentType {
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }
        request.httpBody = body
        return request
    }

    /// Build a request with Bearer + signed session cookie (for passkey verify endpoints).
    /// Also forwards additional cookies (e.g., challenge cookies from passkey flow).
    static func withBearerAndCookies(
        url: URL,
        token: String,
        signedToken: String?,
        additionalCookies: String? = nil,
        method: String = "POST",
        body: Data? = nil,
        contentType: String? = "application/json"
    ) -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(Config.apiBaseURL.absoluteString, forHTTPHeaderField: "Origin")
        if let contentType {
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }
        request.httpBody = body

        // Build cookie header with signed session token + any additional cookies
        var cookieParts: [String] = []
        if let signed = signedToken {
            cookieParts.append("better-auth.session_token=\(signed)")
            cookieParts.append("__Secure-better-auth.session_token=\(signed)")
        }
        if let extra = additionalCookies {
            cookieParts.append(extra)
        }
        if !cookieParts.isEmpty {
            request.setValue(cookieParts.joined(separator: "; "), forHTTPHeaderField: "Cookie")
        }

        return request
    }

    /// Extract cookie name=value pairs from Set-Cookie response headers.
    /// Uses HTTPCookie parsing and preserves URL-encoded values.
    static func extractCookies(from response: HTTPURLResponse, for url: URL) -> String? {
        guard let headerFields = response.allHeaderFields as? [String: String] else { return nil }
        let cookies = HTTPCookie.cookies(withResponseHeaderFields: headerFields, for: url)
        guard !cookies.isEmpty else { return nil }
        let result = cookies.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
        log.debug("Extracted cookies: \(cookies.map { $0.name }.joined(separator: ", "))")
        return result
    }
}
