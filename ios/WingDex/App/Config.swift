import Foundation

/// App-wide configuration constants.
enum Config {
    /// Base URL for the WingDex API.
    ///
    /// Resolution order:
    /// 1. `API_BASE_URL` environment variable (set per-scheme in project.yml)
    /// 2. Release builds fall back to production (wingdex.app)
    /// 3. Debug builds fall back to localhost (localhost.wingdex.app)
    static let apiBaseURL: URL = {
        if let envURL = ProcessInfo.processInfo.environment["API_BASE_URL"],
           let url = URL(string: envURL) {
            return url
        }
        #if DEBUG
        return URL(string: "https://localhost.wingdex.app")!
        #else
        return URL(string: "https://wingdex.app")!
        #endif
    }()

    /// Bundle identifier.
    static let bundleID = "app.wingdex"

    /// OAuth callback URL scheme (for ASWebAuthenticationSession).
    static let oauthCallbackScheme = "wingdex"

    /// WebAuthn Relying Party ID (must match server's rpID and associated domain).
    static let rpID: String = apiBaseURL.host ?? "localhost"

    /// Maximum daily AI identification requests.
    static let aiDailyRateLimit = 150
}
