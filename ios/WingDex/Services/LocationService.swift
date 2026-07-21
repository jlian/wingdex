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
/// Uses the modern `CLLocationUpdate.liveUpdates()` async sequence (iOS 17+)
/// rather than the delegate pattern, which keeps it clean under Swift 6 strict
/// concurrency. When-in-use authorization only; no background tracking.
///
/// Usage: call `start()` when the camera opens, read `latestCoordinate` when a
/// photo is taken, and `stop()` when the capture flow closes.
@MainActor
final class LocationService: ObservableObject {
    /// Most recent location fix, if any.
    @Published private(set) var currentLocation: CLLocation?

    /// Manager retained only to request authorization (no delegate is used).
    private let manager = CLLocationManager()
    private var updatesTask: Task<Void, Never>?

    /// Convenience: the latest coordinate as (lat, lon), or nil if unavailable.
    var latestCoordinate: (lat: Double, lon: Double)? {
        guard let coord = currentLocation?.coordinate,
              CLLocationCoordinate2DIsValid(coord)
        else { return nil }
        return (coord.latitude, coord.longitude)
    }

    /// Request when-in-use permission (if needed) and begin streaming location.
    /// Safe to call repeatedly; a second call is a no-op while already running.
    func start() {
        if manager.authorizationStatus == .notDetermined {
            manager.requestWhenInUseAuthorization()
        }
        guard updatesTask == nil else { return }
        updatesTask = Task { [weak self] in
            do {
                for try await update in CLLocationUpdate.liveUpdates() {
                    guard let self else { return }
                    if let location = update.location {
                        self.currentLocation = location
                    }
                }
            } catch {
                // Non-fatal: capture still works, photo just won't be geotagged.
            }
        }
    }

    /// Stop location updates (call when the capture flow closes to save battery).
    func stop() {
        updatesTask?.cancel()
        updatesTask = nil
    }
}
