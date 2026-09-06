import CoreLocation
import Foundation
import ImageIO
import UIKit
import UniformTypeIdentifiers

struct CameraCapture: Identifiable, Sendable {
    let id: UUID
    let data: Data
    let captureTime: PhotoCaptureTime
    let latitude: Double?
    let longitude: Double?

    static func make(
        image: UIImage, metadata: [String: Any], latitude: Double?, longitude: Double?,
        capturedAt: Date = .now, timeZone: TimeZone = .current
    ) throws -> CameraCapture {
        guard let data = image.jpegData(compressionQuality: 0.95),
              let source = CGImageSourceCreateWithData(data as CFData, nil) else {
            throw CameraCaptureError.encodingFailed
        }
        var properties = metadata
        let encodedProperties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any] ?? [:]
        if let orientation = encodedProperties[kCGImagePropertyOrientation as String] {
            properties[kCGImagePropertyOrientation as String] = orientation
        }
        var exif = properties[kCGImagePropertyExifDictionary as String] as? [CFString: Any] ?? [:]
        let extractedTime = PhotoCaptureTime.fromEXIF(exif, fallbackTimeZone: timeZone)
        let captureTime = PhotoCaptureTime(
            date: extractedTime?.date ?? capturedAt, timeZone: extractedTime?.timeZone ?? timeZone
        )
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = captureTime.timeZone
        formatter.dateFormat = "yyyy:MM:dd HH:mm:ss"
        exif[kCGImagePropertyExifDateTimeOriginal] = formatter.string(from: captureTime.date)
        exif[kCGImagePropertyExifOffsetTimeOriginal] = String(captureTime.storedValue.suffix(6))
        properties[kCGImagePropertyExifDictionary as String] = exif
        properties.removeValue(forKey: kCGImagePropertyGPSDictionary as String)
        var validCoordinate: CLLocationCoordinate2D?
        if let latitude, let longitude {
            let coordinate = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
            if CLLocationCoordinate2DIsValid(coordinate) {
                validCoordinate = coordinate
                properties[kCGImagePropertyGPSDictionary as String] = [
                    kCGImagePropertyGPSLatitude: abs(latitude),
                    kCGImagePropertyGPSLatitudeRef: latitude < 0 ? "S" : "N",
                    kCGImagePropertyGPSLongitude: abs(longitude),
                    kCGImagePropertyGPSLongitudeRef: longitude < 0 ? "W" : "E",
                ] as [CFString: Any]
            }
        }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else {
            throw CameraCaptureError.encodingFailed
        }
        CGImageDestinationAddImageFromSource(destination, source, 0, properties as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw CameraCaptureError.encodingFailed }
        return CameraCapture(
            id: UUID(), data: output as Data, captureTime: captureTime,
            latitude: validCoordinate?.latitude, longitude: validCoordinate?.longitude
        )
    }
}

enum CameraCaptureError: LocalizedError {
    case encodingFailed

    var errorDescription: String? { "Could not prepare this photo. Please take it again." }
}

@MainActor
final class CameraPhotoSaver {
    static let preferenceKey = "saveCameraPhotos"

    private var savedIDs: Set<UUID> = []
    private var savingIDs: Set<UUID> = []
    private let savePhoto: (CameraCapture) async throws -> Void

    init(savePhoto: @escaping (CameraCapture) async throws -> Void = { capture in
        let location: CLLocation? = if let latitude = capture.latitude, let longitude = capture.longitude {
            CLLocation(latitude: latitude, longitude: longitude)
        } else {
            nil
        }
        try await ImageSharingService.saveToPhotos(
            data: capture.data, creationDate: capture.captureTime.date, location: location
        )
    }) {
        self.savePhoto = savePhoto
    }

    func save(_ capture: CameraCapture, enabled: Bool) async throws -> Bool {
        guard enabled, !savedIDs.contains(capture.id), savingIDs.insert(capture.id).inserted else {
            return false
        }
        defer { savingIDs.remove(capture.id) }
        try await savePhoto(capture)
        savedIDs.insert(capture.id)
        return true
    }
}
