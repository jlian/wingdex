import CoreLocation
import MapKit
import XCTest
@testable import WingDex

final class OutingMapLocationTests: XCTestCase {
    func testPreservesExactCoordinatesAndSource() throws {
        let coordinate = CLLocationCoordinate2D(latitude: 47.7115123456, longitude: -122.3717456789)
        let location = try XCTUnwrap(OutingMapLocation(
            name: "My Birding Spot", coordinate: coordinate, sourceDescription: "Current location"
        ))
        XCTAssertEqual(location.coordinate.latitude, coordinate.latitude)
        XCTAssertEqual(location.coordinate.longitude, coordinate.longitude)
        XCTAssertEqual(location.name, "My Birding Spot")
        XCTAssertEqual(location.sourceDescription, "Current location")
    }

    func testMissingAndInvalidCoordinatesHaveNoMap() {
        let coordinates: [CLLocationCoordinate2D?] = [
            nil,
            CLLocationCoordinate2D(latitude: 91, longitude: 0),
            CLLocationCoordinate2D(latitude: 0, longitude: 181),
            CLLocationCoordinate2D(latitude: .nan, longitude: 0),
        ]
        for coordinate in coordinates {
            XCTAssertNil(OutingMapLocation(
                name: "Name only", coordinate: coordinate, sourceDescription: "No GPS data in photos"
            ))
        }
    }

    func testZeroCoordinatesAreValid() throws {
        let location = try XCTUnwrap(OutingMapLocation(
            name: "", coordinate: CLLocationCoordinate2D(latitude: 0, longitude: 0),
            sourceDescription: "From existing outing"
        ))
        XCTAssertEqual(location.latitude, 0)
        XCTAssertEqual(location.longitude, 0)
        XCTAssertEqual(location.name, "Outing")
    }

    func testCameraCentersOnExactOutingLocationWithoutTrackingDevice() throws {
        let location = try XCTUnwrap(OutingMapLocation(
            name: "Carkeek Park",
            coordinate: CLLocationCoordinate2D(latitude: 47.7115123456, longitude: -122.3717456789),
            sourceDescription: "GPS detected"
        ))
        let position = location.cameraPosition
        let camera = try XCTUnwrap(position.camera)
        XCTAssertEqual(camera.centerCoordinate.latitude, location.latitude)
        XCTAssertEqual(camera.centerCoordinate.longitude, location.longitude)
        XCTAssertEqual(camera.distance, 3000)
        XCTAssertFalse(position.followsUserLocation)
        XCTAssertFalse(position.followsUserHeading)
    }
}
