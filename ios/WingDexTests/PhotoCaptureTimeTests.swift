@testable import WingDex
import Foundation
import ImageIO
import XCTest

final class PhotoCaptureTimeTests: XCTestCase {
    func testEXIFOffsetOverridesImportDeviceTimeZone() throws {
        let time = try XCTUnwrap(PhotoCaptureTime.fromEXIF([
            kCGImagePropertyExifDateTimeOriginal: "2026:08:18 07:13:00",
            kCGImagePropertyExifOffsetTimeOriginal: "-06:00",
        ], fallbackTimeZone: TimeZone(secondsFromGMT: 0)!))
        XCTAssertEqual(time.storedValue, "2026-08-18T07:13:00-06:00")
        XCTAssertEqual(time.date, DateFormatting.sortDate("2026-08-18T13:13:00Z"))
        XCTAssertEqual(time.resolved(in: TimeZone(identifier: "Asia/Tokyo")!), time)
    }

    func testMissingOffsetCanResolveToOutingTimeZoneWithoutChangingTheEXIFClock() throws {
        let time = try XCTUnwrap(PhotoCaptureTime.fromEXIF([
            kCGImagePropertyExifDateTimeOriginal: "2026:08:18 07:13:00",
        ], fallbackTimeZone: TimeZone(secondsFromGMT: 0)!))
        let resolved = time.resolved(in: TimeZone(identifier: "America/Guatemala")!)
        XCTAssertEqual(resolved.storedValue, "2026-08-18T07:13:00-06:00")
        XCTAssertEqual(resolved.resolved(in: time.timeZone), time)
    }

    func testInvalidOffsetFallsBackAndInvalidDateIsRejected() throws {
        let time = try XCTUnwrap(PhotoCaptureTime.fromEXIF([
            kCGImagePropertyExifDateTimeOriginal: "2026:08:18 07:13:00",
            kCGImagePropertyExifOffsetTimeOriginal: "+25:99",
        ], fallbackTimeZone: TimeZone(secondsFromGMT: 0)!))
        XCTAssertEqual(time.storedValue, "2026-08-18T07:13:00+00:00")
        XCTAssertNil(PhotoCaptureTime.fromEXIF([kCGImagePropertyExifDateTimeOriginal: "not a date"]))
        XCTAssertNil(DateFormatting.offsetTimeZone("+14:01"))
    }

    func testStorageRespectsDayBoundaryAndNonWholeHourOffset() {
        let instant = DateFormatting.sortDate("2026-09-01T02:13:00Z")
        XCTAssertEqual(DateFormatting.storageString(instant, timeZone: TimeZone(identifier: "America/Guatemala")!),
                       "2026-08-31T20:13:00-06:00")
        XCTAssertEqual(DateFormatting.storageString(instant, timeZone: TimeZone(identifier: "Asia/Kolkata")!),
                       "2026-09-01T07:43:00+05:30")
    }

    func testDurationUsesElapsedTimeAcrossDaylightSavingChanges() {
        XCTAssertEqual(DateFormatting.duration(from: "2026-03-08T01:30:00-08:00", to: "2026-03-08T03:30:00-07:00"), "1h 0m")
        XCTAssertEqual(DateFormatting.duration(from: "2026-11-01T01:30:00-07:00", to: "2026-11-01T01:30:00-08:00"), "1h 0m")
        XCTAssertNil(DateFormatting.duration(from: "invalid", to: "2026-08-18T07:13:00-06:00"))
    }
}
