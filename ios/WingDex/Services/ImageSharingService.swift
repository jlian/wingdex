import Foundation
import Photos
import UIKit

enum ImageSharingService {
    static func downloadImage(from url: URL) async throws -> Data {
        let (data, response) = try await URLSession.shared.data(from: url)
        guard let httpResponse = response as? HTTPURLResponse,
              (200..<300).contains(httpResponse.statusCode),
              UIImage(data: data) != nil
        else {
            throw ImageSharingError.invalidImage
        }
        return data
    }

    static func shareFile(
        data: Data,
        sourceURL: URL,
        directory: URL = FileManager.default.temporaryDirectory
    ) throws -> ExportFileItem {
        let fileExtension = sourceURL.pathExtension.isEmpty ? "jpg" : sourceURL.pathExtension
        let shareDirectory = directory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: shareDirectory, withIntermediateDirectories: true)
        let url = shareDirectory.appendingPathComponent("wingdex-bird.\(fileExtension)")
        try data.write(to: url, options: .atomic)
        return ExportFileItem(url: url, cleanupDirectory: shareDirectory)
    }

    static func saveToPhotos(data: Data) async throws {
        guard UIImage(data: data) != nil else {
            throw ImageSharingError.invalidImage
        }

        let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard status == .authorized || status == .limited else {
            throw ImageSharingError.photoLibraryAccessDenied
        }

        try await PHPhotoLibrary.shared().performChanges {
            let request = PHAssetCreationRequest.forAsset()
            request.addResource(with: .photo, data: data, options: nil)
        }
    }
}

enum ImageSharingError: LocalizedError {
    case invalidImage
    case photoLibraryAccessDenied

    var errorDescription: String? {
        switch self {
        case .invalidImage:
            "Could not download this bird image."
        case .photoLibraryAccessDenied:
            "Allow WingDex to add photos in Settings, then try again."
        }
    }
}