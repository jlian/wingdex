import CoreLocation
import Foundation

/// Provides the device's current location for geotagging in-app camera captures.
///
/// The photo-library path already reads GPS from each photo's EXIF metadata
/// (`PhotoService.extractEXIF`), but photos captured with the in-app camera are
/// bare pixels with no embedded location. This service supplies the device's
/// current coordinate at capture time so camera photos get the same GPS signal
/// the range-prior pipeline (and future on-device model) relies on.
///
/// Usage: hold a single instance for the capture flow, call `requestAuthorization()`
/// when the camera opens, and read `currentLocation` (or `latestCoordinate`) when
/// a photo is taken. When-in-use authorization only; no background tracking.
@MainActor
final class LocationService: NSObject, ObservableObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()

    /// Most recent location fix, if any.
    @Published private(set) var currentLocation: CLLocation?

    /// Current authorization status.
    @Published private(set) var authorizationStatus: CLAuthorizationStatus = .notDetermined

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        authorizationStatus = manager.authorizationStatus
    }

    /// Convenience: the latest coordinate as (lat, lon), or nil if unavailable.
    var latestCoordinate: (lat: Double, lon: Double)? {
        guard let coord = currentLocation?.coordinate,
              CLLocationCoordinate2DIsValid(coord)
        else { return nil }
        return (coord.latitude, coord.longitude)
    }

    /// Whether we currently have permission to read location.
    var isAuthorized: Bool {
        authorizationStatus == .authorizedWhenInUse || authorizationStatus == .authorizedAlways
    }

    /// Request when-in-use permission and begin updating if granted. Safe to call
    /// repeatedly (e.g. each time the camera opens).
    func requestAuthorization() {
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways:
            manager.startUpdatingLocation()
        default:
            break // denied/restricted: photos simply won't be geotagged
        }
    }

    /// Stop location updates (call when the capture flow closes to save battery).
    func stop() {
        manager.stopUpdatingLocation()
    }

    // MARK: - CLLocationManagerDelegate

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            self.authorizationStatus = status
            if status == .authorizedWhenInUse || status == .authorizedAlways {
                manager.startUpdatingLocation()
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        Task { @MainActor in
            self.currentLocation = loc
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Non-fatal: capture still works, photo just won't be geotagged.
    }
}
