@testable import WingDex
import XCTest

final class GeocodingServiceTests: XCTestCase {
    func testDecodesNormalizedGeocodingResult() throws {
        let data = Data(#"""
        {
          "label": "Discovery Park",
          "context": "Seattle, Washington",
          "lat": 47.6573,
          "lon": -122.4055,
          "stateProvince": "US-WA",
          "countryCode": "US"
        }
        """#.utf8)

        let result = try JSONDecoder().decode(GeocodingResult.self, from: data)

        XCTAssertEqual(result.label, "Discovery Park")
        XCTAssertEqual(result.context, "Seattle, Washington")
        XCTAssertEqual(result.latitude, 47.6573)
        XCTAssertEqual(result.longitude, -122.4055)
        XCTAssertEqual(result.stateProvince, "US-WA")
        XCTAssertEqual(result.countryCode, "US")
        XCTAssertNil(result.timeZone)
    }

    func testDecodesOptionalGeographicTimeZone() throws {
        let data = Data(#"{"label":"Quetzal","lat":15.23,"lon":-90.23,"timeZone":"America/Guatemala"}"#.utf8)
        let result = try JSONDecoder().decode(GeocodingResult.self, from: data)
        XCTAssertEqual(result.timeZone, "America/Guatemala")
    }

    func testResultIdentityIncludesCoordinatesAndLabel() throws {
        let result = GeocodingResult(
            label: "Green Lake",
            context: "Seattle, Washington",
            latitude: 47.68,
            longitude: -122.33,
            stateProvince: "US-WA",
            countryCode: "US"
        )

        XCTAssertEqual(result.id, "47.68,-122.33,Green Lake")
    }

    func testServerErrorRetainsTraceID() {
        let error = GeocodingServiceError.server(
            statusCode: 503,
            traceID: "0123456789abcdef0123456789abcdef"
        )

        guard case .server(let statusCode, let traceID, let retryAfter) = error else {
            return XCTFail("Expected server error")
        }
        XCTAssertEqual(statusCode, 503)
        XCTAssertEqual(traceID, "0123456789abcdef0123456789abcdef")
        XCTAssertNil(retryAfter)
    }

    func testServerErrorDecodesRetryAfterHeaderAndTraceID() throws {
        for (header, expected) in [("45", 45.0), ("0.5", 0.5), ("invalid", nil), (nil, nil)] {
            var headers = ["X-Trace-Id": "0123456789ABCDEF0123456789abcdef"]
            headers["Retry-After"] = header
            let response = try XCTUnwrap(HTTPURLResponse(
                url: URL(string: "https://example.com/api/geocoding/search")!,
                statusCode: 429, httpVersion: nil, headerFields: headers
            ))
            guard case .server(let statusCode, let traceID, let retryAfter) =
                GeocodingServiceError.serverResponse(response) else {
                return XCTFail("Expected server error")
            }
            XCTAssertEqual(statusCode, 429)
            XCTAssertEqual(traceID, "0123456789abcdef0123456789abcdef")
            XCTAssertEqual(retryAfter, expected)
        }
    }
}
