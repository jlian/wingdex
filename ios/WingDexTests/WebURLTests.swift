import XCTest
@testable import WingDex

final class WebURLTests: XCTestCase {
    func testAcceptsHTTPAndHTTPS() {
        XCTAssertNotNil(WebURL(url: URL(string: "https://commons.wikimedia.org/wiki/File:Bird.jpg")!))
        XCTAssertNotNil(WebURL(url: URL(string: "http://example.org")!))
    }

    func testAcceptsCommonsFilePagesWithParenthesesAndPercentEncoding() {
        let page = "https://commons.wikimedia.org/wiki/File:Great-tailed_Grackle_(Quiscalus_mexicanus)_male.jpg"
        XCTAssertEqual(WebURL(url: URL(string: page)!)?.url, URL(string: page))
        let encoded = "https://commons.wikimedia.org/wiki/File:Struthio_camelus_%283%29.jpg"
        XCTAssertEqual(WebURL(url: URL(string: encoded)!)?.url, URL(string: encoded))
    }

    func testRejectsSchemelessAndNonWebURLs() {
        // A relative URL is what a truncated markdown destination produces.
        XCTAssertNil(WebURL(url: URL(string: "commons.wikimedia.org/wiki/File:Bird.jpg")!))
        XCTAssertNil(WebURL(url: URL(string: "file:///etc/passwd")!))
        XCTAssertNil(WebURL(url: URL(string: "javascript:alert(1)")!))
        XCTAssertNil(WebURL(url: URL(string: "wingdex://species/robin")!))
    }

    func testSchemeMatchIsCaseInsensitive() {
        XCTAssertNotNil(WebURL(url: URL(string: "HTTPS://example.org")!))
    }
}
