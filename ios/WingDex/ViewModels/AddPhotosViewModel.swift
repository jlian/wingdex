import Foundation
import Observation
import PhotosUI
import SwiftUI

/// ViewModel for the multi-step Add Photos wizard flow.
///
/// Flow: Select Photos -> Extract EXIF -> Cluster into Outings -> AI Identify -> Review -> Confirm -> Save
@Observable
final class AddPhotosViewModel {
    // Step tracking
    enum Step {
        case selectPhotos
        case processing
        case review
        case confirm
    }

    var currentStep: Step = .selectPhotos

    // Photo selection
    var selectedItems: [PhotosPickerItem] = []
    var processedPhotos: [ProcessedPhoto] = []

    // Clustering results
    var clusters: [PhotoCluster] = []

    // AI identification results (keyed by photo ID)
    var identifications: [String: IdentificationResult] = [:]

    // State
    var isProcessing = false
    var error: String?

    /// Process selected photos: extract EXIF, generate thumbnails, cluster.
    func processSelectedPhotos() async {
        // TODO: Use PhotoService for EXIF extraction + compression
        // TODO: Cluster photos by time/distance
        isProcessing = true
        defer { isProcessing = false }
        currentStep = .processing
    }

    /// Send photos to the AI identification endpoint.
    func identifyBirds() async {
        // TODO: POST each photo to /api/identify-bird
        // TODO: Collect candidates and crop boxes
    }

    /// Save confirmed outings and observations to the API.
    func confirmAndSave() async {
        // TODO: POST /api/data/outings for each cluster
        // TODO: POST /api/data/observations for confirmed species
        // TODO: POST /api/data/photos for photo metadata
    }
}

/// A photo after EXIF extraction and compression.
struct ProcessedPhoto: Identifiable {
    let id: String
    let image: Data
    let thumbnail: Data
    let exifTime: Date?
    let gpsLat: Double?
    let gpsLon: Double?
    let fileHash: String
    let fileName: String
}

/// A group of photos clustered into a single outing.
struct PhotoCluster: Identifiable {
    let id = UUID()
    var photos: [ProcessedPhoto]
    var startTime: Date
    var endTime: Date
    var centerLat: Double?
    var centerLon: Double?
}

/// Result from the AI bird identification endpoint.
struct IdentificationResult {
    let candidates: [IdentifiedCandidate]
    let cropBox: CropBoxResult?
    let multipleBirds: Bool
}

struct IdentifiedCandidate {
    let species: String
    let confidence: Double
    let wikiTitle: String?
}

struct CropBoxResult {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}
