@testable import WingDex
import XCTest

/// Test the native client's real request/response path, not the server's CRUD
/// implementation (covered by the Worker and browser suites).
@MainActor
final class AuthTransportTests: XCTestCase {
    private var session: URLSession!
    private var auth: AuthService!

    override func setUp() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.protocolClasses = [AuthTransportURLProtocol.self]
        session = URLSession(configuration: configuration)
        AuthTransportURLProtocol.reset()
        auth = AuthService(session: session)
        await auth.signOut()
        AuthTransportURLProtocol.reset()
    }

    override func tearDown() async throws {
        await auth.signOut()
        session.invalidateAndCancel()
    }

    func testAnonymousBearerLifecycleAndRevocation() async throws {
        try await auth.ensureAnonymousSession()
        XCTAssertEqual(auth.identity, .anonymous)
        XCTAssertEqual(auth.userId, "transport-user")
        XCTAssertEqual(auth.signedSessionToken, "transport-token.signature")
        let validation = await auth.validateSession()
        XCTAssertEqual(validation, .valid)

        let service = DataService(auth: auth, session: session)
        let data = try await service.fetchAllData()
        XCTAssertTrue(data.outings.isEmpty)
        await auth.signOut()
        XCTAssertEqual(auth.identity, .none)

        let requests = AuthTransportURLProtocol.requests
        let signIn = try XCTUnwrap(requests.first { $0.url?.path == "/api/auth/sign-in/anonymous" })
        XCTAssertEqual(signIn.httpMethod, "POST")
        XCTAssertEqual(signIn.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(signIn.value(forHTTPHeaderField: "Origin"), Config.apiBaseURL.absoluteString)
        for path in ["/api/data/all", "/api/auth/get-session", "/api/auth/sign-out"] {
            let request = try XCTUnwrap(requests.first { $0.url?.path == path })
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer transport-token")
            XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
            XCTAssertNotNil(request.value(forHTTPHeaderField: "traceparent"))
        }
        XCTAssertEqual(requests.first { $0.url?.path == "/api/auth/sign-out" }?.httpMethod, "POST")
    }

    func testRejectedBearerInvalidatesTheCurrentNativeSession() async throws {
        try await auth.ensureAnonymousSession()
        AuthTransportURLProtocol.dataStatus = 401
        do {
            _ = try await DataService(auth: auth, session: session).fetchAllData()
            XCTFail("Rejected bearer unexpectedly loaded account data")
        } catch {
            XCTAssertEqual(auth.identity, .none)
            XCTAssertNotNil(auth.signInMessage)
        }
    }

    func testSessionlessDataRequestDoesNotReachTransport() async {
        do {
            _ = try await DataService(auth: auth, session: session).fetchAllData()
            XCTFail("Sessionless request unexpectedly succeeded")
        } catch {
            XCTAssertTrue(AuthTransportURLProtocol.requests.isEmpty)
        }
    }

    func testFailedAnonymousSignInDoesNotInstallIdentity() async {
        AuthTransportURLProtocol.signInStatus = 503
        do {
            try await auth.ensureAnonymousSession()
            XCTFail("Failed sign-in unexpectedly succeeded")
        } catch {
            XCTAssertEqual(auth.identity, .none)
            XCTAssertNil(auth.userId)
        }
    }
}

private final class AuthTransportURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var recorded: [URLRequest] = []
    nonisolated(unsafe) private static var statuses = (signIn: 200, data: 200)
    static var requests: [URLRequest] { lock.withLock { recorded } }
    static var signInStatus: Int {
        get { lock.withLock { statuses.signIn } }
        set { lock.withLock { statuses.signIn = newValue } }
    }
    static var dataStatus: Int {
        get { lock.withLock { statuses.data } }
        set { lock.withLock { statuses.data = newValue } }
    }
    static func reset() {
        lock.withLock { recorded = []; statuses = (200, 200) }
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.withLock { Self.recorded.append(request) }
        let path = request.url!.path
        let body: String
        let status: Int
        switch path {
        case "/api/auth/sign-in/anonymous":
            body = #"{"token":"transport-token","user":{"id":"transport-user","name":"Test Bird","isAnonymous":true},"session":{"id":"session","userId":"transport-user","expiresAt":"2099-01-01T00:00:00Z"}}"#
            status = Self.signInStatus
        case "/api/auth/get-session":
            body = #"{"user":{"id":"transport-user","name":"Test Bird","isAnonymous":true},"session":{"id":"session","userId":"transport-user","expiresAt":"2099-01-01T00:00:00Z"}}"#
            status = 200
        case "/api/data/all":
            body = #"{"outings":[],"photos":[],"observations":[],"dex":[]}"#
            status = Self.dataStatus
        case "/api/auth/sign-out":
            body = "{}"
            status = 200
        default:
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
            headerFields: ["set-auth-token": "transport-token.signature", "Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
