import CryptoKit
import Foundation
import Observation
import PhotosUI
import SwiftUI
import os

private let log = Logger(subsystem: "app.wingdex", category: "AddPhotos")

/// ViewModel for the multi-step Add Photos wizard flow.
///
/// Flow: Select Photos -> Extract EXIF & Cluster -> AI Identify -> Review -> Confirm -> Save
@MainActor
@Observable
final class AddPhotosViewModel {
    // Step tracking
    enum Step: Equatable {
        case selectPhotos
        case processing
        case review
        case confirm
        case saving
        case done
    }

    var currentStep: Step = .selectPhotos

    // Photo selection
    var selectedItems: [PhotosPickerItem] = []
    var processedPhotos: [ProcessedPhoto] = []

    // Clustering results
    var clusters: [PhotoCluster] = []

    // AI identification results (keyed by photo ID)
    var identifications: [String: IdentificationResult] = [:]

    // Per-photo user decisions: photo ID -> chosen species name (nil = skip)
    var confirmedSpecies: [String: String] = [:]

    // State
    var isProcessing = false
    var processingMessage = ""
    var processedCount = 0
    var totalCount = 0
    var error: String?

    // Results after save
    var savedOutingCount = 0
    var savedObservationCount = 0
    var newSpeciesCount = 0

    private var dataService: DataService?
    private var dataStore: DataStore?

    func configure(dataService: DataService, dataStore: DataStore) {
        self.dataService = dataService
        self.dataStore = dataStore
    }

    /// Process selected photos: load data, extract EXIF, generate thumbnails, cluster.
    func processSelectedPhotos() async {
        guard !selectedItems.isEmpty else { return }
        isProcessing = true
        error = nil
        currentStep = .processing
        totalCount = selectedItems.count
        processedCount = 0
        processingMessage = "Loading photos..."

        var photos: [ProcessedPhoto] = []

        for item in selectedItems {
            do {
                guard let data = try await item.loadTransferable(type: Data.self) else { continue }

                let id = UUID().uuidString
                let (exifDate, lat, lon) = PhotoService.extractEXIF(from: data)

                guard let image = UIImage(data: data) else { continue }
                let compressed = PhotoService.compressImage(image, quality: 0.7) ?? data
                let thumbnail = PhotoService.generateThumbnail(from: data, maxDimension: 200) ?? data

                let fileHash = computeFileHash(data)

                photos.append(ProcessedPhoto(
                    id: id,
                    image: compressed,
                    thumbnail: thumbnail,
                    exifTime: exifDate,
                    gpsLat: lat,
                    gpsLon: lon,
                    fileHash: fileHash,
                    fileName: "photo_\(id).jpg"
                ))
            } catch {
                log.error("Failed to load photo: \(error.localizedDescription)")
            }
            processedCount += 1
        }

        processedPhotos = photos
        processingMessage = "Clustering into outings..."

        clusters = PhotoService.clusterPhotos(photos)

        // Photos without EXIF time go into a single "Unknown Date" cluster
        let noDate = photos.filter { $0.exifTime == nil }
        if !noDate.isEmpty {
            clusters.append(PhotoCluster(
                photos: noDate,
                startTime: Date(),
                endTime: Date(),
                centerLat: nil,
                centerLon: nil
            ))
        }

        log.info("Processed \(photos.count) photos into \(self.clusters.count) clusters")
        isProcessing = false
        currentStep = .review
    }

    /// Send each photo to the AI identification endpoint.
    func identifyBirds() async {
        guard let service = dataService else { return }
        isProcessing = true
        processingMessage = "Identifying birds..."
        processedCount = 0
        totalCount = processedPhotos.count

        for photo in processedPhotos {
            do {
                guard let image = UIImage(data: photo.image) else { continue }

                // Compress to 640px max for the API
                let maxDim: CGFloat = 640
                let scale = min(maxDim / max(image.size.width, image.size.height), 1.0)
                let newSize = CGSize(
                    width: image.size.width * scale,
                    height: image.size.height * scale
                )
                let renderer = UIGraphicsImageRenderer(size: newSize)
                let resized = renderer.jpegData(withCompressionQuality: 0.7) { context in
                    image.draw(in: CGRect(origin: .zero, size: newSize))
                }

                let base64 = resized.base64EncodedString()
                let dataUrl = "data:image/jpeg;base64,\(base64)"

                var request = DataService.IdentifyBirdRequest(
                    imageDataUrl: dataUrl,
                    imageWidth: Int(newSize.width),
                    imageHeight: Int(newSize.height),
                    model: "fast"
                )

                if let lat = photo.gpsLat, let lon = photo.gpsLon {
                    request.lat = lat
                    request.lon = lon
                }
                if let date = photo.exifTime {
                    request.month = Calendar.current.component(.month, from: date)
                }

                let response = try await service.identifyBird(request)

                let candidates = (response.candidates ?? []).map {
                    IdentifiedCandidate(species: $0.species, confidence: $0.confidence, wikiTitle: $0.wikiTitle)
                }
                let cropBox: CropBoxResult? = response.cropBox.map {
                    CropBoxResult(x: $0.x, y: $0.y, width: $0.width, height: $0.height)
                }

                identifications[photo.id] = IdentificationResult(
                    candidates: candidates,
                    cropBox: cropBox,
                    multipleBirds: response.multipleBirds ?? false
                )

                // Auto-confirm top candidate if confidence is high enough
                if let top = candidates.first, top.confidence >= 0.75 {
                    confirmedSpecies[photo.id] = top.species
                }
            } catch {
                log.error("AI identification failed for photo \(photo.id): \(error.localizedDescription)")
            }
            processedCount += 1
        }

        isProcessing = false
    }

    /// Save confirmed outings and observations to the API.
    func confirmAndSave() async {
        guard let service = dataService, let store = dataStore else { return }
        currentStep = .saving
        isProcessing = true
        processingMessage = "Saving..."
        error = nil

        let existingSpecies: Set<String> = await MainActor.run { Set(store.dex.map(\.speciesName)) }
        var totalObservations = 0
        var allNewSpecies = Set<String>()

        do {
            for cluster in clusters {
                let photosWithSpecies = cluster.photos.filter { confirmedSpecies[$0.id] != nil }
                guard !photosWithSpecies.isEmpty else { continue }

                let formatter = ISO8601DateFormatter()
                let outingId = UUID().uuidString

                // Create outing
                let outing = Outing(
                    id: outingId,
                    userId: "",
                    startTime: formatter.string(from: cluster.startTime),
                    endTime: formatter.string(from: cluster.endTime),
                    locationName: "",
                    defaultLocationName: nil,
                    lat: cluster.centerLat,
                    lon: cluster.centerLon,
                    stateProvince: nil,
                    countryCode: nil,
                    protocol: nil,
                    numberObservers: nil,
                    allObsReported: nil,
                    effortDistanceMiles: nil,
                    effortAreaAcres: nil,
                    notes: "",
                    createdAt: formatter.string(from: Date())
                )

                let savedOuting = try await service.createOuting(outing)
                savedOutingCount += 1

                // Create photo metadata
                let photoPayloads = cluster.photos.map { photo in
                    DataService.PhotoPayload(
                        id: photo.id,
                        outingId: savedOuting.id,
                        exifTime: photo.exifTime.map { formatter.string(from: $0) },
                        gps: (photo.gpsLat != nil && photo.gpsLon != nil)
                            ? DataService.PhotoPayload.PhotoGPS(lat: photo.gpsLat!, lon: photo.gpsLon!)
                            : nil,
                        fileHash: photo.fileHash,
                        fileName: photo.fileName
                    )
                }
                try await service.createPhotos(photoPayloads)

                // Group confirmed species by name, count occurrences
                var speciesCounts: [String: (count: Int, representativePhotoId: String, confidence: Double)] = [:]
                for photo in photosWithSpecies {
                    guard let species = confirmedSpecies[photo.id] else { continue }
                    let confidence = identifications[photo.id]?.candidates.first?.confidence ?? 0
                    if let existing = speciesCounts[species] {
                        speciesCounts[species] = (existing.count + 1, existing.representativePhotoId, max(existing.confidence, confidence))
                    } else {
                        speciesCounts[species] = (1, photo.id, confidence)
                    }
                }

                // Create observations
                let observations = speciesCounts.map { species, info in
                    BirdObservation(
                        id: UUID().uuidString,
                        outingId: savedOuting.id,
                        speciesName: species,
                        count: info.count,
                        certainty: .confirmed,
                        representativePhotoId: info.representativePhotoId,
                        aiConfidence: info.confidence,
                        speciesComments: "",
                        notes: ""
                    )
                }

                if !observations.isEmpty {
                    let response = try await service.createObservations(observations)
                    totalObservations += observations.count

                    for obs in observations {
                        if !existingSpecies.contains(obs.speciesName) {
                            allNewSpecies.insert(obs.speciesName)
                        }
                    }

                    // Apply dex updates if returned
                    if let dexUpdates = response.dexUpdates {
                        await MainActor.run {
                            store.dex = dexUpdates
                        }
                    }
                }
            }

            savedObservationCount = totalObservations
            newSpeciesCount = allNewSpecies.count

            // Reload to get full server state
            await store.loadAll()

            currentStep = .done
        } catch {
            self.error = error.localizedDescription
            log.error("Save failed: \(error.localizedDescription)")
        }
        isProcessing = false
    }

    /// Simple hash: SHA-256 of first 64KB + size (matches web's approach).
    private func computeFileHash(_ data: Data) -> String {
        let prefix = data.prefix(65536)
        var hasher = SHA256()
        hasher.update(data: prefix)
        withUnsafeBytes(of: data.count) { hasher.update(bufferPointer: $0) }
        let digest = hasher.finalize()
        return digest.map { String(format: "%02x", $0) }.joined()
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
