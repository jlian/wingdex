import Foundation
import os

private let log = Logger(subsystem: Config.bundleID, category: "API")

/// Centralized helper for building authenticated API requests.
///
/// Better Auth has two auth mechanisms:
/// - **Bearer token**: Used by the `bearer()` plugin for middleware-protected routes
///   (`/api/data/*`) and some auth endpoints (`get-session`).
///   Accepts the raw session token.
/// - **Session cookie**: Used by Better Auth's internal plugin endpoints (all passkey
///   endpoints) which do their own cookie-based session validation.
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

    /// Build a request with signed session cookie only (NO Bearer).
    /// Used for Better Auth internal plugin endpoints (passkey register, verify)
    /// where mixing Bearer + cookies causes auth failures.
    /// Optionally forwards additional cookies (e.g., challenge cookies).
    static func withCookieOnly(
        url: URL,
        signedToken: String,
        additionalCookies: String? = nil,
        method: String = "GET",
        body: Data? = nil,
        contentType: String? = nil
    ) -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue(Config.apiBaseURL.absoluteString, forHTTPHeaderField: "Origin")
        if let contentType {
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }
        request.httpBody = body

        // Session cookie only - both prefixed variants for HTTP/HTTPS compat
        var cookieParts = [
            "better-auth.session_token=\(signedToken)",
            "__Secure-better-auth.session_token=\(signedToken)",
        ]
        if let extra = additionalCookies {
            cookieParts.append(extra)
        }
        request.setValue(cookieParts.joined(separator: "; "), forHTTPHeaderField: "Cookie")

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

    /// Validate an HTTP response, logging failures with private body redaction.
    ///
    /// Returns the HTTPURLResponse on success. Throws `PasskeyError.serverError`
    /// with a user-friendly message (status code only) on failure. The raw response
    /// body is logged at error level with `.private` privacy so it is redacted in
    /// logs unless private data is explicitly enabled.
    @discardableResult
    static func validateHTTP(
        _ response: URLResponse,
        data: Data,
        context: String,
        logger: Logger = log
    ) throws -> HTTPURLResponse {
        guard let http = response as? HTTPURLResponse,
              (200...299).contains(http.statusCode)
        else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? -1
            let body = String(data: data.prefix(512), encoding: .utf8) ?? ""
            logger.error("\(context): HTTP \(status), body: \(body, privacy: .private)")
            throw PasskeyError.serverError("\(context) (HTTP \(status))")
        }
        return http
    }
}
