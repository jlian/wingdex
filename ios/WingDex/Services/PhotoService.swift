import CoreLocation
import Foundation
import ImageIO
import UIKit

/// Handles EXIF extraction, image compression, and outing clustering.
///
/// Outing clustering uses the same algorithm as the web app (clustering.ts):
/// - Time threshold: 2 hours between consecutive photos
/// - Distance threshold: 3 km (Haversine)
/// - Tight time threshold: 30 minutes (for matching existing outings with relaxed distance)
/// - Relaxed distance: 50 km (when time match is tight)
enum PhotoService {
    // MARK: - Clustering Constants

    /// Maximum time gap between consecutive photos in the same outing.
    static let timeThreshold: TimeInterval = 2 * 60 * 60 // 2 hours

    /// Maximum distance (km) between consecutive photos in the same outing.
    static let maxDistanceKm: Double = 3.0

    /// Tight time threshold for matching existing outings.
    static let tightTimeThreshold: TimeInterval = 30 * 60 // 30 minutes

    /// Relaxed distance (km) when time match is tight.
    static let relaxedDistanceKm: Double = 50.0

    // MARK: - EXIF Extraction

    /// Extract EXIF date and GPS from image data using ImageIO.
    static func extractEXIF(from imageData: Data) -> (date: Date?, lat: Double?, lon: Double?) {
        guard let source = CGImageSourceCreateWithData(imageData as CFData, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        else {
            return (nil, nil, nil)
        }

        // Date
        var date: Date?
        if let exifDict = properties[kCGImagePropertyExifDictionary] as? [CFString: Any],
           let dateString = exifDict[kCGImagePropertyExifDateTimeOriginal] as? String
        {
            let formatter = DateFormatter()
            formatter.dateFormat = "yyyy:MM:dd HH:mm:ss"
            date = formatter.date(from: dateString)
        }

        // GPS
        var lat: Double?
        var lon: Double?
        if let gpsDict = properties[kCGImagePropertyGPSDictionary] as? [CFString: Any] {
            if let latitude = gpsDict[kCGImagePropertyGPSLatitude] as? Double,
               let latRef = gpsDict[kCGImagePropertyGPSLatitudeRef] as? String
            {
                lat = latRef == "S" ? -latitude : latitude
            }
            if let longitude = gpsDict[kCGImagePropertyGPSLongitude] as? Double,
               let lonRef = gpsDict[kCGImagePropertyGPSLongitudeRef] as? String
            {
                lon = lonRef == "W" ? -longitude : longitude
            }
        }

        return (date, lat, lon)
    }

    // MARK: - Image Compression

    /// Compress a UIImage to JPEG at the given quality (0.0-1.0).
    static func compressImage(_ image: UIImage, quality: CGFloat = 0.7) -> Data? {
        image.jpegData(compressionQuality: quality)
    }

    /// Generate a thumbnail from image data at the given max dimension.
    static func generateThumbnail(from imageData: Data, maxDimension: CGFloat = 200) -> Data? {
        guard let image = UIImage(data: imageData) else { return nil }
        let scale = min(maxDimension / image.size.width, maxDimension / image.size.height, 1.0)
        let newSize = CGSize(width: image.size.width * scale, height: image.size.height * scale)

        let renderer = UIGraphicsImageRenderer(size: newSize)
        let thumbnail = renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: newSize))
        }
        return thumbnail.jpegData(compressionQuality: 0.6)
    }

    // MARK: - Clustering

    /// Cluster photos into outings based on time and distance proximity.
    ///
    /// Matches the web app's `clusterPhotosIntoOutings` algorithm:
    /// - Sort by EXIF time
    /// - Sequential sweep: if time diff <= 2hr AND (no GPS or GPS distance <= 3km), same cluster
    static func clusterPhotos(_ photos: [ProcessedPhoto]) -> [PhotoCluster] {
        let sorted = photos
            .filter { $0.exifTime != nil }
            .sorted { ($0.exifTime ?? .distantPast) < ($1.exifTime ?? .distantPast) }

        guard let first = sorted.first else { return [] }

        var clusters: [PhotoCluster] = []
        var currentPhotos = [first]
        var currentStart = first.exifTime ?? Date()
        var currentEnd = currentStart

        for photo in sorted.dropFirst() {
            let photoTime = photo.exifTime ?? Date()
            let timeDiff = photoTime.timeIntervalSince(currentEnd)

            let withinTime = timeDiff <= timeThreshold
            let withinDistance: Bool = {
                guard let prevPhoto = currentPhotos.last,
                      let lat1 = prevPhoto.gpsLat, let lon1 = prevPhoto.gpsLon,
                      let lat2 = photo.gpsLat, let lon2 = photo.gpsLon
                else {
                    return true // No GPS = assume same location
                }
                return haversineDistance(lat1: lat1, lon1: lon1, lat2: lat2, lon2: lon2) <= maxDistanceKm
            }()

            if withinTime && withinDistance {
                currentPhotos.append(photo)
                currentEnd = photoTime
            } else {
                clusters.append(makeCluster(photos: currentPhotos, start: currentStart, end: currentEnd))
                currentPhotos = [photo]
                currentStart = photoTime
                currentEnd = photoTime
            }
        }

        if !currentPhotos.isEmpty {
            clusters.append(makeCluster(photos: currentPhotos, start: currentStart, end: currentEnd))
        }

        return clusters
    }

    // MARK: - Haversine Distance

    /// Haversine distance between two GPS points in kilometers.
    static func haversineDistance(lat1: Double, lon1: Double, lat2: Double, lon2: Double) -> Double {
        let earthRadiusKm = 6371.0
        let dLat = (lat2 - lat1) * .pi / 180
        let dLon = (lon2 - lon1) * .pi / 180
        let a = sin(dLat / 2) * sin(dLat / 2) +
            cos(lat1 * .pi / 180) * cos(lat2 * .pi / 180) *
            sin(dLon / 2) * sin(dLon / 2)
        let c = 2 * atan2(sqrt(a), sqrt(1 - a))
        return earthRadiusKm * c
    }

    // MARK: - Private

    private static func makeCluster(photos: [ProcessedPhoto], start: Date, end: Date) -> PhotoCluster {
        let lats = photos.compactMap(\.gpsLat)
        let lons = photos.compactMap(\.gpsLon)
        let centerLat = lats.isEmpty ? nil : lats.reduce(0, +) / Double(lats.count)
        let centerLon = lons.isEmpty ? nil : lons.reduce(0, +) / Double(lons.count)

        return PhotoCluster(
            photos: photos,
            startTime: start,
            endTime: end,
            centerLat: centerLat,
            centerLon: centerLon
        )
    }
}
