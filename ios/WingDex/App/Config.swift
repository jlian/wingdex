import Foundation

/// App-wide configuration constants.
enum Config {
    /// Base URL for the WingDex API.
    /// - Simulator: localhost.wingdex.app (local Mac via DNS, HTTPS)
    /// - Physical device (DEBUG): dev.wingdex.app (Cloudflare Pages preview)
    /// - Release: wingdex.app (production)
    static let apiBaseURL: URL = {
        #if DEBUG
            #if targetEnvironment(simulator)
            URL(string: "https://localhost.wingdex.app")!
            #else
            URL(string: "https://localhost.wingdex.app")!
            // URL(string: "https://dev.wingdex.app")!
            #endif
        #else
        URL(string: "https://wingdex.app")!
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
