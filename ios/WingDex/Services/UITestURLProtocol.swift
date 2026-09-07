#if DEBUG
import Foundation

/// In-process transport for sessionless UI journeys. Unknown requests fail closed:
/// no UI test can accidentally select a localhost, preview, or production backend.
final class UITestURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let path = request.url?.path ?? ""
        let json: String
        switch path {
        case "/api/auth/sign-in/anonymous":
            if ProcessInfo.processInfo.arguments.contains("--ui-test-auth-failure") {
                client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
                return
            }
            json = #"{"token":"ui-test-token","user":{"id":"ui-test-account","name":"Swift Sparrow","isAnonymous":true},"session":{"id":"ui-test-session","userId":"ui-test-account","expiresAt":"2099-01-01T00:00:00Z"}}"#
        case "/api/auth/get-session":
            json = #"{"user":{"id":"ui-test-account","name":"Swift Sparrow","isAnonymous":true},"session":{"id":"ui-test-session","userId":"ui-test-account","expiresAt":"2099-01-01T00:00:00Z"}}"#
        case "/api/auth/sign-out":
            json = "{}"
        case "/api/data/all":
            json = #"{"outings":[],"photos":[],"observations":[],"dex":[]}"#
        default:
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }
        let response = HTTPURLResponse(
            url: request.url!, statusCode: 200, httpVersion: nil,
            headerFields: ["Content-Type": "application/json", "set-auth-token": "ui-test-token.signature"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(json.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
#endif
