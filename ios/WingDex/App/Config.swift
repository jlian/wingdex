import Foundation

/// App-wide configuration constants.
enum Config {
    /// Base URL for the WingDex API.
    /// - Simulator: wingdev.johnspecificproblems.net (local Mac via DNS, HTTPS)
    /// - Physical device (DEBUG): dev.wingdex.pages.dev (preview deployment with dev D1 database)
    /// - Release: wingdex.app (production)
    static let apiBaseURL: URL = {
        #if DEBUG
            #if targetEnvironment(simulator)
            URL(string: "https://wingdev.johnspecificproblems.net")!
            #else
            URL(string: "https://wingdev.johnspecificproblems.net")!
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
