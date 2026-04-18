import CryptoKit
import Foundation
import Observation
import PhotosUI
import SwiftUI
import os

private let log = Logger(subsystem: Config.bundleID, category: "AddPhotos")

/// ViewModel for the multi-step Add Photos wizard flow.
///
/// Flow: selectPhotos -> extracting -> outingReview -> photoProcessing ->
///       perPhotoConfirm -> (manualCrop) -> [next photo or save] -> done
///
/// Matches the web app's AddPhotosFlow.tsx state machine. Each photo is
/// confirmed individually (per-photo) rather than in a batch list.
@MainActor
@Observable
final class AddPhotosViewModel {

    enum CropPromptContext: Equatable {
        case manualRecrop
        case noDetection
        case multipleBirds

        var reasonText: String {
            switch self {
            case .manualRecrop:
                return "For best results, crop to one bird"
            case .noDetection:
                return "No bird species identified, crop to the bird"
            case .multipleBirds:
                return "Multiple birds detected, crop to one"
            }
        }
    }

    // MARK: - Step State Machine

    /// All possible steps in the add-photos wizard.
    enum Step: Equatable {
        case selectPhotos
        case extracting
        case outingReview
        case photoProcessing
        case perPhotoConfirm
        case manualCrop
        case saving
        case done
    }

    var currentStep: Step = .selectPhotos

    // MARK: - Photo Selection

    var selectedItems: [PhotosPickerItem] = []
    var processedPhotos: [ProcessedPhoto] = []

    /// Photos captured via the camera (UIImage, not from PhotosPicker).
    var cameraPhotos: [UIImage] = []

    // MARK: - Clustering

    var clusters: [PhotoCluster] = []
    var currentClusterIndex = 0

    // MARK: - GPS Context Toggle

    /// When true, send GPS and date context to the AI for better identification.
    /// Persisted in UserDefaults so it survives between sessions and is editable from Settings.
    var useGeoContext: Bool {
        get { UserDefaults.standard.object(forKey: "useGeoContext") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "useGeoContext") }
    }

    // MARK: - Outing Review State

    /// Location name from the most recent outing - used as default for new outings.
    var lastLocationName = ""

    /// The outing ID that the current cluster is being saved into.
    var currentOutingId = ""

    // MARK: - Per-Photo Identification State

    /// Index of the photo currently being processed/confirmed within the current cluster.
    var currentPhotoIndex = 0

    /// AI candidates for the photo currently being confirmed.
    var currentCandidates: [IdentifiedCandidate] = []

    /// Whether range-prior data was used to adjust confidence.
    var rangeAdjusted = false

    /// Why the crop UI is being shown. This is driven by the same AI response
    /// conditions as the web flow rather than inferred from currentCandidates.
    var cropPromptContext: CropPromptContext = .manualRecrop

    /// Per-photo results accumulated during the per-photo confirmation loop.
    var photoResults: [PhotoResult] = []

    /// Progress percentage (0-100) for the exponential progress animation.
    var photoProgress: Double = 0

    /// Time constant (ms) for the exponential progress bar animation.
    /// Fast model ~1200ms, strong model ~4400ms.
    var photoProgressTauMs: Double = 1200

    /// Incremented to restart the progress animation timer.
    var photoProgressRunKey = 0

    // MARK: - Processing State

    var isProcessing = false
    var processingMessage = ""
    var processedCount = 0
    var totalCount = 0
    var extractionProgress: Double = 0
    var error: String?

    // MARK: - Duplicate Detection

    var pendingNewPhotos: [ProcessedPhoto] = []
    var pendingDuplicatePhotos: [ProcessedPhoto] = []
    var showDuplicateConfirm = false

    // MARK: - Results After Save

    /// Accumulated stats across all clusters in this upload session.
    var uploadSummary: UploadSummary?
    var savedOutingCount = 0
    var savedObservationCount = 0
    var newSpeciesCount = 0

    // MARK: - Dependencies

    private var dataService: DataService?
    private var dataStore: DataStore?

    func configure(dataService: DataService, dataStore: DataStore) {
        self.dataService = dataService
        self.dataStore = dataStore
        // Initialize lastLocationName from the most recent outing
        if let mostRecent = dataStore.outings
            .sorted(by: { DateFormatting.sortDate($0.createdAt) > DateFormatting.sortDate($1.createdAt) })
            .first
        {
            lastLocationName = mostRecent.locationName
        }
    }

    // MARK: - Convenience

    /// Photos belonging to the current cluster.
    var clusterPhotos: [ProcessedPhoto] {
        guard currentClusterIndex < clusters.count else { return [] }
        return clusters[currentClusterIndex].photos
    }

    /// The full ProcessedPhoto for the current photo index.
    var currentPhoto: ProcessedPhoto? {
        let photos = clusterPhotos
        guard currentPhotoIndex < photos.count else { return nil }
        return photos[currentPhotoIndex]
    }

    // MARK: - Camera Support

    /// Add a photo captured from the camera.
    func addCameraPhoto(_ image: UIImage) {
        cameraPhotos.append(image)
    }

    // MARK: - Step 1: Process Selected Photos

    /// Load photos from the picker and camera, extract EXIF, generate thumbnails, cluster.
    func processSelectedPhotos() async {
        guard !selectedItems.isEmpty || !cameraPhotos.isEmpty else { return }
        isProcessing = true
        error = nil
        currentStep = .extracting
        totalCount = selectedItems.count + cameraPhotos.count
        processedCount = 0
        extractionProgress = 0
        processingMessage = "Reading photo data..."

        // Reset accumulated stats for this upload session
        uploadSummary = nil

        var newPhotos: [ProcessedPhoto] = []
        var duplicatePhotos: [ProcessedPhoto] = []

        for item in selectedItems {
            do {
                guard let data = try await item.loadTransferable(type: Data.self) else { continue }
                let id = UUID().uuidString
                let (exifDate, lat, lon) = PhotoService.extractEXIF(from: data)

                guard let image = UIImage(data: data) else { continue }
                let compressed = PhotoService.compressImage(image, quality: 0.7) ?? data
                let thumbnail = PhotoService.generateThumbnail(from: data, maxDimension: 200) ?? data
                let fileHash = computeFileHash(data)

                let photo = ProcessedPhoto(
                    id: id,
                    image: compressed,
                    thumbnail: thumbnail,
                    exifTime: exifDate,
                    gpsLat: lat,
                    gpsLon: lon,
                    fileHash: fileHash,
                    fileName: "photo_\(id).jpg"
                )

                // Check for duplicate against existing data
                let isDup = dataStore?.photos.contains { existing in
                    existing.fileHash == fileHash
                } ?? false

                if isDup {
                    duplicatePhotos.append(photo)
                } else {
                    newPhotos.append(photo)
                }
            } catch {
                log.error("Failed to load photo: \(error.localizedDescription)")
            }
            processedCount += 1
            extractionProgress = Double(processedCount) / Double(totalCount) * 100
        }

        // Process camera-captured photos (no EXIF GPS, use capture time as now)
        for uiImage in cameraPhotos {
            let id = UUID().uuidString
            let compressed = PhotoService.compressImage(uiImage, quality: 0.7) ?? Data()
            let thumbnail = PhotoService.generateThumbnail(from: compressed, maxDimension: 200) ?? compressed
            let fileHash = computeFileHash(compressed)

            let photo = ProcessedPhoto(
                id: id,
                image: compressed,
                thumbnail: thumbnail,
                exifTime: Date(),
                gpsLat: nil,
                gpsLon: nil,
                fileHash: fileHash,
                fileName: "camera_\(id).jpg"
            )
            newPhotos.append(photo)
            processedCount += 1
            extractionProgress = Double(processedCount) / Double(totalCount) * 100
        }
        cameraPhotos = []

        if newPhotos.isEmpty && duplicatePhotos.isEmpty {
            error = "No photos to process"
            currentStep = .selectPhotos
            isProcessing = false
            return
        }

        // Handle duplicates
        if !duplicatePhotos.isEmpty {
            pendingNewPhotos = newPhotos
            pendingDuplicatePhotos = duplicatePhotos
            currentStep = .selectPhotos
            isProcessing = false
            showDuplicateConfirm = true
            return
        }

        finishExtraction(photos: newPhotos)
    }

    /// Called after duplicate resolution - finalize extraction with the chosen photos.
    func handleDuplicateChoice(reimport: Bool) {
        showDuplicateConfirm = false
        let finalPhotos = reimport
            ? pendingNewPhotos + pendingDuplicatePhotos
            : pendingNewPhotos
        pendingNewPhotos = []
        pendingDuplicatePhotos = []

        if finalPhotos.isEmpty {
            selectedItems = []
            currentStep = .selectPhotos
            return
        }

        currentStep = .extracting
        finishExtraction(photos: finalPhotos)
    }

    private func finishExtraction(photos: [ProcessedPhoto]) {
        processedPhotos = photos
        processingMessage = "Clustering into outings..."
        clusters = PhotoService.clusterPhotos(photos)

        // Photos without EXIF time go into a single "Unknown Date" cluster
        let noDate = photos.filter { $0.exifTime == nil }
        if !noDate.isEmpty && !clusters.contains(where: { $0.photos.contains(where: { $0.exifTime == nil }) }) {
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
        currentClusterIndex = 0
        currentStep = .outingReview
    }

    // MARK: - Step 2: Outing Confirmed -> Start Per-Photo Loop

    /// Called when the user confirms the outing in OutingReviewView.
    /// Creates photo metadata on the server immediately (matching web flow),
    /// then starts the per-photo AI identification loop.
    func outingConfirmed(outingId: String, locationName: String) {
        let normalizedName = locationName.trimmingCharacters(in: .whitespacesAndNewlines)
        lastLocationName = normalizedName
        currentOutingId = outingId
        photoResults = []
        currentCandidates = []
        rangeAdjusted = false
        cropPromptContext = .manualRecrop
        currentPhotoIndex = 0

        // Save photo metadata to server BEFORE AI identification starts.
        // The observation table has a FK to photo(id), so photos must exist first.
        Task {
            await createPhotoMetadata(outingId: outingId)
            await runSpeciesId(photoIndex: 0)
        }
    }

    /// Persist photo metadata for the current cluster to the server.
    /// Must be called before creating observations (FK constraint on representativePhotoId).
    private func createPhotoMetadata(outingId: String) async {
        guard let service = dataService else { return }
        let photos = clusterPhotos
        let formatter = ISO8601DateFormatter()
        let payloads = photos.map { photo in
            DataService.PhotoPayload(
                id: photo.id,
                outingId: outingId,
                exifTime: photo.exifTime.map { formatter.string(from: $0) },
                gps: (photo.gpsLat != nil && photo.gpsLon != nil)
                    ? DataService.PhotoPayload.PhotoGPS(lat: photo.gpsLat!, lon: photo.gpsLon!)
                    : nil,
                fileHash: photo.fileHash,
                fileName: photo.fileName
            )
        }
        do {
            try await service.createPhotos(payloads)
            log.info("Saved \(payloads.count) photo metadata records for outing \(outingId)")
        } catch {
            log.error("Failed to save photo metadata: \(error.localizedDescription)")
        }
    }

    // MARK: - Step 3: Species Identification (Two-Tier AI)

    /// Send a single photo to the AI for identification.
    ///
    /// Implements the web app's two-tier escalation strategy:
    /// 1. Send with `model: "fast"` (~1.2s)
    /// 2. If confidence < 0.75 OR gap between top-2 < 0.15, re-send with `model: "strong"` (~4.4s)
    func runSpeciesId(photoIndex: Int, croppedImageData: Data? = nil) async {
        guard let service = dataService else { return }
        let photos = clusterPhotos
        guard photoIndex < photos.count else { return }
        let photo = photos[photoIndex]

        currentPhotoIndex = photoIndex
        photoProgress = 0
        currentStep = .photoProcessing
        photoProgressTauMs = 1200
        photoProgressRunKey += 1

        let isCropped = croppedImageData != nil || photo.croppedImage != nil
        let imageToSend = croppedImageData ?? photo.croppedImage ?? photo.image
        processingMessage = "Photo \(photoIndex + 1)/\(photos.count): Identifying species..."

        do {
            // Compress to 640px max dimension
            guard let uiImage = UIImage(data: imageToSend) else {
                log.warning("Could not create UIImage for photo \(photo.id)")
                currentCandidates = []
                rangeAdjusted = false
                currentStep = .perPhotoConfirm
                return
            }

            let dataUrl = compressAndEncode(uiImage)
            let width = Int(uiImage.size.width)
            let height = Int(uiImage.size.height)

            var request = DataService.IdentifyBirdRequest(
                imageDataUrl: dataUrl,
                imageWidth: width,
                imageHeight: height,
                model: "fast"
            )

            // Attach GPS context if enabled
            if useGeoContext, let lat = photo.gpsLat, let lon = photo.gpsLon {
                request.lat = lat
                request.lon = lon
            }
            if useGeoContext, let date = photo.exifTime {
                request.month = Calendar.current.component(.month, from: date) - 1
            }
            if useGeoContext, !lastLocationName.isEmpty {
                request.locationName = lastLocationName
            }

            // Fast model first
            let fastResult = try await service.identifyBird(request)
            let fastCandidates = (fastResult.candidates ?? []).map {
                IdentifiedCandidate(species: $0.species, confidence: $0.confidence, wikiTitle: $0.wikiTitle, plumage: $0.plumage, rangeStatus: $0.rangeStatus)
            }
            let fastCropBox: CropBoxResult? = fastResult.cropBox.map {
                CropBoxResult(x: $0.x, y: $0.y, width: $0.width, height: $0.height)
            }

            // Store AI crop box on photo if available
            if let cropBox = fastCropBox {
                storeCropBox(photoId: photo.id, cropBox: cropBox)
            }

            // If no bird found or multiple birds detected on full image, prompt crop
            if !isCropped && (fastCandidates.isEmpty || (fastResult.multipleBirds ?? false)) {
                photoProgress = 100
                try? await Task.sleep(for: .milliseconds(240))
                if fastResult.multipleBirds ?? false {
                    log.info("Multiple birds detected, asking user to crop")
                    currentCandidates = fastCandidates
                    cropPromptContext = .multipleBirds
                } else {
                    log.info("No species identified, asking user to crop")
                    currentCandidates = []
                    cropPromptContext = .noDetection
                }
                currentStep = .manualCrop
                rangeAdjusted = false
                return
            }

            // Escalation logic: re-send with strong model if uncertain
            let topConfidence = fastCandidates.first?.confidence ?? 0
            let secondConfidence = fastCandidates.count >= 2 ? fastCandidates[1].confidence : 0
            let shouldEscalate = topConfidence < 0.75
                || (fastCandidates.count >= 2 && (topConfidence - secondConfidence) < 0.15)

            var finalCandidates = fastCandidates
            var finalCropBox = fastCropBox
            var finalMultipleBirds = fastResult.multipleBirds ?? false
            var finalRangeAdjusted = fastResult.rangeAdjusted ?? false

            if shouldEscalate {
                processingMessage = "Photo \(photoIndex + 1)/\(photos.count): Re-analyzing with enhanced model..."
                photoProgress = 0
                photoProgressTauMs = 4400
                photoProgressRunKey += 1

                request = DataService.IdentifyBirdRequest(
                    imageDataUrl: dataUrl,
                    imageWidth: width,
                    imageHeight: height,
                    model: "strong"
                )
                if useGeoContext, let lat = photo.gpsLat, let lon = photo.gpsLon {
                    request.lat = lat
                    request.lon = lon
                }
                if useGeoContext, let date = photo.exifTime {
                    request.month = Calendar.current.component(.month, from: date) - 1
                }
                if useGeoContext, !lastLocationName.isEmpty {
                    request.locationName = lastLocationName
                }

                let strongResult = try await service.identifyBird(request)
                finalCandidates = (strongResult.candidates ?? []).map {
                    IdentifiedCandidate(species: $0.species, confidence: $0.confidence, wikiTitle: $0.wikiTitle, plumage: $0.plumage, rangeStatus: $0.rangeStatus)
                }
                finalMultipleBirds = strongResult.multipleBirds ?? false
                finalRangeAdjusted = strongResult.rangeAdjusted ?? false
                if let box = strongResult.cropBox {
                    finalCropBox = CropBoxResult(x: box.x, y: box.y, width: box.width, height: box.height)
                    storeCropBox(photoId: photo.id, cropBox: finalCropBox!)
                }
            }

            log.info("Found \(finalCandidates.count) candidates for photo \(photoIndex + 1)")
            photoProgress = 100
            rangeAdjusted = finalRangeAdjusted
            try? await Task.sleep(for: .milliseconds(240))

            if finalCandidates.isEmpty && !isCropped {
                currentCandidates = []
                cropPromptContext = .noDetection
                currentStep = .manualCrop
            } else if finalMultipleBirds && !isCropped {
                currentCandidates = finalCandidates
                cropPromptContext = .multipleBirds
                currentStep = .manualCrop
            } else {
                currentCandidates = finalCandidates
                cropPromptContext = .manualRecrop
                currentStep = .perPhotoConfirm
            }
        } catch {
            log.error("Species ID failed for photo \(photoIndex + 1): \(error.localizedDescription)")
            self.error = error.localizedDescription
            currentCandidates = []
            rangeAdjusted = false
            currentStep = .perPhotoConfirm
        }
    }

    // MARK: - Step 4: Per-Photo Confirmation

    /// User confirms species for the current photo with a certainty level.
    func confirmCurrentPhoto(species: String, confidence: Double, status: ObservationStatus, count: Int) {
        let result = PhotoResult(
            photoId: currentPhoto?.id ?? "",
            species: species,
            confidence: confidence,
            status: status,
            count: count
        )
        photoResults.append(result)
        advanceToNextPhoto()
    }

    /// Skip the current photo (exclude from save).
    func skipCurrentPhoto() {
        advanceToNextPhoto()
    }

    /// Go back to the previous photo, removing its result so the user can re-decide.
    func goBackToPreviousPhoto() {
        guard currentPhotoIndex > 0 else { return }
        if !photoResults.isEmpty {
            photoResults.removeLast()
        }
        currentCandidates = []
        rangeAdjusted = false
        Task { await runSpeciesId(photoIndex: currentPhotoIndex - 1) }
    }

    /// Trigger manual crop, then re-identify with the cropped image.
    func requestManualCrop() {
        cropPromptContext = .manualRecrop
        currentStep = .manualCrop
    }

    /// After user crops, re-identify the cropped image.
    func handleCropComplete(croppedImageData: Data) {
        storeCroppedImage(photoId: currentPhoto?.id, imageData: croppedImageData)
        Task { await runSpeciesId(photoIndex: currentPhotoIndex, croppedImageData: croppedImageData) }
    }

    /// Cancel crop -> go to confirm screen with current (possibly empty) candidates.
    func cancelCrop() {
        rangeAdjusted = false
        currentStep = .perPhotoConfirm
    }

    // MARK: - Advance / Save

    /// Move to the next photo or save when all photos in the cluster are done.
    private func advanceToNextPhoto() {
        let nextIdx = currentPhotoIndex + 1
        if nextIdx < clusterPhotos.count {
            currentCandidates = []
            rangeAdjusted = false
            cropPromptContext = .manualRecrop
            Task { await runSpeciesId(photoIndex: nextIdx) }
        } else {
            Task { await saveCurrentCluster() }
        }
    }

    /// Save all confirmed observations for the current cluster,
    /// then advance to the next cluster or finish.
    private func saveCurrentCluster() async {
        guard let service = dataService, let store = dataStore else { return }
        currentStep = .saving
        isProcessing = true
        processingMessage = "Saving..."
        error = nil

        let confirmed = photoResults.filter { $0.status == .confirmed || $0.status == .possible }
        let existingSpecies = Set(store.dex.map(\.speciesName))

        // Group by species, sum counts
        var speciesMap: [String: (count: Int, status: ObservationStatus, photoId: String)] = [:]
        for r in confirmed {
            if let existing = speciesMap[r.species] {
                speciesMap[r.species] = (existing.count + r.count, existing.status, existing.photoId)
            } else {
                speciesMap[r.species] = (r.count, r.status, r.photoId)
            }
        }

        let observations = speciesMap.map { species, info in
            BirdObservation(
                id: "obs_\(UUID().uuidString)",
                outingId: currentOutingId,
                speciesName: species,
                count: info.count,
                certainty: info.status,
                representativePhotoId: info.photoId,
                notes: ""
            )
        }

        do {
            if !observations.isEmpty {
                let response = try await service.createObservations(observations)
                if let dexUpdates = response.dexUpdates {
                    store.dex = dexUpdates
                }
            }

            // Photo metadata was already created in outingConfirmed() before AI started

            // Count new species
            var clusterNewSpecies = 0
            for obs in observations where !existingSpecies.contains(obs.speciesName) {
                clusterNewSpecies += 1
            }
            newSpeciesCount += clusterNewSpecies
            savedOutingCount += 1
            savedObservationCount += observations.count

            // Accumulate upload summary
            let outingName = store.outings.first(where: { $0.id == currentOutingId })?.locationName ?? ""
            let uniqueSpecies = Set(confirmed.map(\.species)).count
            let totalCount = confirmed.reduce(0) { $0 + $1.count }
            if var summary = uploadSummary {
                summary.newSpecies += clusterNewSpecies
                summary.outings += 1
                summary.totalSpecies += uniqueSpecies
                summary.totalCount += totalCount
                if !outingName.isEmpty && !summary.locationNames.contains(outingName) {
                    summary.locationNames.append(outingName)
                }
                uploadSummary = summary
            } else {
                uploadSummary = UploadSummary(
                    newSpecies: clusterNewSpecies,
                    outings: 1,
                    totalSpecies: uniqueSpecies,
                    totalCount: totalCount,
                    locationNames: outingName.isEmpty ? [] : [outingName]
                )
            }

            // Brief "saved" notice before advancing
            processingMessage = "Outing saved!"
            try? await Task.sleep(for: .milliseconds(1200))

            // Move to next cluster or finish
            if currentClusterIndex < clusters.count - 1 {
                currentClusterIndex += 1
                currentPhotoIndex = 0
                photoResults = []
                currentCandidates = []
                rangeAdjusted = false
                cropPromptContext = .manualRecrop
                currentStep = .outingReview
            } else {
                await store.loadAll()
                currentStep = .done
            }
        } catch {
            self.error = error.localizedDescription
            log.error("Save failed: \(error.localizedDescription)")
        }
        isProcessing = false
    }

    // MARK: - Helpers

    /// Compress a UIImage to 640px max and encode as a data URL for the API.
    private func compressAndEncode(_ image: UIImage) -> String {
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
        return "data:image/jpeg;base64,\(base64)"
    }

    /// Store a crop box on a photo for later use in CropView.
    private func storeCropBox(photoId: String, cropBox: CropBoxResult) {
        if let idx = processedPhotos.firstIndex(where: { $0.id == photoId }) {
            processedPhotos[idx].aiCropBox = cropBox
        }
        // Also update within clusters
        for ci in clusters.indices {
            for pi in clusters[ci].photos.indices where clusters[ci].photos[pi].id == photoId {
                clusters[ci].photos[pi].aiCropBox = cropBox
            }
        }
    }

    private func storeCroppedImage(photoId: String?, imageData: Data) {
        guard let photoId else { return }
        let thumbnail = PhotoService.generateThumbnail(from: imageData, maxDimension: 200) ?? imageData

        if let idx = processedPhotos.firstIndex(where: { $0.id == photoId }) {
            processedPhotos[idx].croppedImage = imageData
            processedPhotos[idx].thumbnail = thumbnail
        }

        for ci in clusters.indices {
            for pi in clusters[ci].photos.indices where clusters[ci].photos[pi].id == photoId {
                clusters[ci].photos[pi].croppedImage = imageData
                clusters[ci].photos[pi].thumbnail = thumbnail
            }
        }
    }

    /// SHA-256 of first 64KB + size (matches web's computeFileHash approach).
    private func computeFileHash(_ data: Data) -> String {
        let prefix = data.prefix(65536)
        var hasher = SHA256()
        hasher.update(data: prefix)
        withUnsafeBytes(of: data.count) { hasher.update(bufferPointer: $0) }
        let digest = hasher.finalize()
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}

// MARK: - Supporting Types

/// A photo after EXIF extraction and compression.
struct ProcessedPhoto: Identifiable {
    let id: String
    let image: Data        // Compressed JPEG for API submission
    var thumbnail: Data    // Small thumbnail for display
    let exifTime: Date?
    let gpsLat: Double?
    let gpsLon: Double?
    let fileHash: String
    let fileName: String
    /// AI-suggested crop box (percentage coordinates), stored after identification.
    var aiCropBox: CropBoxResult?
    /// User-confirmed cropped image used for re-analysis and preview, matching web croppedDataUrl.
    var croppedImage: Data? = nil
}

/// A group of photos clustered into a single outing by time and GPS proximity.
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

/// A single AI candidate species with confidence score.
struct IdentifiedCandidate {
    let species: String
    let confidence: Double
    let wikiTitle: String?
    let plumage: String?
    let rangeStatus: String?
}

/// AI crop box in percentage coordinates (0-100).
struct CropBoxResult: Sendable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

/// Result of per-photo confirmation by the user.
struct PhotoResult {
    let photoId: String
    let species: String
    let confidence: Double
    let status: ObservationStatus
    let count: Int
}

/// Accumulated stats for the upload summary screen.
struct UploadSummary {
    var newSpecies: Int
    var outings: Int
    var totalSpecies: Int
    var totalCount: Int
    var locationNames: [String]
}
