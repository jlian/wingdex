import Foundation

/// Limits reference links to web pages, including URLs supplied by Wikimedia.
struct WebURL {
    let url: URL

    init?(url: URL) {
        switch url.scheme?.lowercased() {
        case "http", "https": break
        default: return nil
        }
        self.url = url
    }
}
