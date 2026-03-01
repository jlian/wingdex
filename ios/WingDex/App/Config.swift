import Foundation

/// App-wide configuration constants.
enum Config {
    /// Base URL for the WingDex API.
    static let apiBaseURL: URL = {
        #if DEBUG
        // Local Cloudflare Pages dev server
        URL(string: "http://localhost:5000")!
        #else
        URL(string: "https://wingdex.pages.dev")!
        #endif
    }()

    /// Bundle identifier.
    static let bundleID = "app.wingdex"

    /// OAuth callback URL scheme (for ASWebAuthenticationSession).
    static let oauthCallbackScheme = "wingdex"

    /// Access token lifetime in seconds (~15 min).
    static let accessTokenLifetime: TimeInterval = 900

    /// Maximum daily AI identification requests.
    static let aiDailyRateLimit = 150
}
