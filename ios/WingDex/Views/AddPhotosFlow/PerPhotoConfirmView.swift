import SwiftUI
import os

private let log = Logger(subsystem: "app.wingdex", category: "PerPhotoConfirm")

/// Per-photo species confirmation view in the Add Photos flow.
///
/// Displays the user's photo alongside a Wikipedia reference image for
/// visual comparison, with a color-coded confidence bar and action buttons
/// for Confirm, Possible, Skip, Back, and Crop & Retry.
///
/// Matches the web app's `PerPhotoConfirm` component in AddPhotosFlow.tsx.
struct PerPhotoConfirmView: View {
    @Bindable var viewModel: AddPhotosViewModel

    // MARK: - Local State

    /// The currently selected species (may differ from AI top candidate if user picks alternative).
    @State private var selectedSpecies = ""
    @State private var selectedConfidence: Double = 0
    @State private var showAlternatives = false
    @State private var wikiImageURL: URL?
    @State private var isLoadingWikiImage = false

    // MARK: - Computed

    private var photo: ProcessedPhoto? { viewModel.currentPhoto }
    private var candidates: [IdentifiedCandidate] { viewModel.currentCandidates }
    private var photoIndex: Int { viewModel.currentPhotoIndex }
    private var totalPhotos: Int { viewModel.clusterPhotos.count }
    private var isHighConfidence: Bool { selectedConfidence >= 0.8 }
    private var confidencePercent: Int { Int(selectedConfidence * 100) }

    private var displayName: String { getDisplayName(selectedSpecies) }
    private var scientificName: String? { getScientificName(selectedSpecies) }

    // MARK: - Body

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                if candidates.isEmpty {
                    noCandidatesView
                } else {
                    candidateConfirmView
                }

                // Photo progress dots
                PhotoProgressDots(current: photoIndex, total: totalPhotos)
            }
            .padding()
        }
        .background(Color.pageBg.ignoresSafeArea())
        .onAppear { initializeSelection() }
        .onChange(of: viewModel.currentPhotoIndex) { initializeSelection() }
        .onChange(of: viewModel.currentCandidates.count) { initializeSelection() }
    }

    // MARK: - No Candidates View

    /// Shown when the AI found no bird species in the photo.
    private var noCandidatesView: some View {
        VStack(spacing: 16) {
            // Photo thumbnail
            photoThumbnail

            Text("No bird species identified in this photo.")
                .font(.subheadline)
                .foregroundStyle(Color.mutedText)
                .multilineTextAlignment(.center)

            HStack(spacing: 12) {
                Button {
                    viewModel.requestManualCrop()
                } label: {
                    Label("Crop & Retry", systemImage: "crop")
                        .font(.subheadline.weight(.medium))
                        .frame(maxWidth: .infinity, minHeight: 40)
                }
                .buttonStyle(.bordered)

                Button {
                    viewModel.skipCurrentPhoto()
                } label: {
                    Label("Skip", systemImage: "forward.fill")
                        .font(.subheadline.weight(.medium))
                        .frame(maxWidth: .infinity, minHeight: 40)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.mutedText)
            }
        }
    }

    // MARK: - Candidate Confirmation View

    /// Main confirmation UI with photo comparison, confidence bar, and action buttons.
    private var candidateConfirmView: some View {
        VStack(spacing: 16) {
            // Side-by-side photo comparison
            photoComparisonRow

            // Species result card
            speciesResultCard

            // Bottom action buttons
            bottomActions
        }
    }

    // MARK: - Photo Comparison

    /// User's photo next to a Wikipedia reference image for visual comparison.
    private var photoComparisonRow: some View {
        HStack(alignment: .top, spacing: 12) {
            // User's photo (cropped to AI region if available)
            VStack(spacing: 4) {
                photoThumbnail
                Text(photo?.aiCropBox != nil ? "Your photo (cropped)" : "Your photo")
                    .font(.caption2)
                    .foregroundStyle(Color.mutedText)
            }
            .frame(maxWidth: .infinity)

            // Wikipedia reference image
            VStack(spacing: 4) {
                wikiReferenceImage
                Text("Wikipedia reference")
                    .font(.caption2)
                    .foregroundStyle(Color.mutedText)
            }
            .frame(maxWidth: .infinity)
        }
    }

    /// The user's photo thumbnail, using AI crop box zoom if available.
    private var photoThumbnail: some View {
        Group {
            if let photo, let uiImage = UIImage(data: photo.thumbnail) {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 140, height: 140)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .strokeBorder(Color.warmBorder, lineWidth: 2)
                    )
            } else {
                RoundedRectangle(cornerRadius: 10)
                    .fill(Color.cardBg)
                    .frame(width: 140, height: 140)
                    .overlay(
                        Image(systemName: "photo")
                            .foregroundStyle(Color.mutedText)
                    )
            }
        }
    }

    /// Wikipedia reference image fetched for the selected species.
    private var wikiReferenceImage: some View {
        Group {
            if let url = wikiImageURL {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                            .frame(width: 140, height: 140)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .overlay(
                                RoundedRectangle(cornerRadius: 10)
                                    .strokeBorder(Color.mutedText.opacity(0.3), lineWidth: 2)
                            )
                    case .failure:
                        wikiPlaceholder
                    default:
                        wikiPlaceholder
                            .overlay(ProgressView().controlSize(.small))
                    }
                }
            } else if isLoadingWikiImage {
                wikiPlaceholder
                    .overlay(ProgressView().controlSize(.small))
            } else {
                wikiPlaceholder
            }
        }
    }

    private var wikiPlaceholder: some View {
        RoundedRectangle(cornerRadius: 10)
            .fill(Color.cardBg)
            .frame(width: 140, height: 140)
            .overlay(
                Image(systemName: "bird")
                    .font(.title2)
                    .foregroundStyle(Color.mutedText.opacity(0.5))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(Color.mutedText.opacity(0.3), lineWidth: 2)
            )
    }

    // MARK: - Species Result Card

    private var speciesResultCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Species name + confidence percentage
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(displayName)
                        .font(.system(size: 18, weight: .semibold, design: .serif))
                        .foregroundStyle(Color.foregroundText)
                    if let sci = scientificName {
                        Text(sci)
                            .font(.subheadline.italic())
                            .foregroundStyle(Color.mutedText)
                    }
                }
                Spacer()
                Text("\(confidencePercent)%")
                    .font(.system(size: 28, weight: .semibold, design: .serif).monospacedDigit())
                    .foregroundStyle(confidenceColor)
            }

            // Color-coded confidence bar
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 4)
                        .fill(Color.mutedText.opacity(0.15))
                        .frame(height: 8)
                    RoundedRectangle(cornerRadius: 4)
                        .fill(confidenceColor)
                        .frame(width: geo.size.width * selectedConfidence, height: 8)
                }
            }
            .frame(height: 8)

            // High confidence: auto-selected with Confirm button
            if isHighConfidence && !showAlternatives {
                highConfidenceActions
            } else {
                // Low confidence or alternatives expanded: Confirm + Possible buttons + candidate list
                lowConfidenceActions
            }
        }
        .padding(16)
        .background(Color.cardBg)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(Color.warmBorder, lineWidth: 1)
        )
    }

    // MARK: - Action Layouts

    /// High confidence: auto-selected, show Confirm + "N more" button.
    private var highConfidenceActions: some View {
        VStack(spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                Text("High confidence, auto-selected")
                    .font(.subheadline)
                    .foregroundStyle(.green)
            }

            HStack(spacing: 10) {
                Button {
                    confirmWith(status: .confirmed)
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "checkmark.circle")
                        Text("Confirm")
                        if photoIndex < totalPhotos - 1 {
                            Image(systemName: "arrow.right")
                                .font(.caption)
                        }
                    }
                    .font(.subheadline.weight(.medium))
                    .frame(maxWidth: .infinity, minHeight: 40)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color.accentColor)

                if candidates.count > 1 {
                    Button {
                        showAlternatives = true
                    } label: {
                        Text("\(candidates.count - 1) more")
                            .font(.subheadline.weight(.medium))
                            .frame(minHeight: 40)
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
    }

    /// Low confidence: Confirm + Possible buttons, full candidate list.
    private var lowConfidenceActions: some View {
        VStack(spacing: 12) {
            // Confirm / Possible buttons
            HStack(spacing: 10) {
                Button {
                    confirmWith(status: .confirmed)
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "checkmark.circle")
                        Text("Confirm")
                    }
                    .font(.subheadline.weight(.medium))
                    .frame(maxWidth: .infinity, minHeight: 40)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color.accentColor)

                Button {
                    confirmWith(status: .possible)
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "questionmark.circle")
                        Text("Possible")
                    }
                    .font(.subheadline.weight(.medium))
                    .frame(maxWidth: .infinity, minHeight: 40)
                }
                .buttonStyle(.bordered)
            }

            // All candidate alternatives
            if candidates.count > 1 {
                VStack(alignment: .leading, spacing: 4) {
                    Text("ALL POSSIBILITIES")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(Color.mutedText)
                        .tracking(1)

                    ForEach(candidates, id: \.species) { candidate in
                        let isSelected = candidate.species == selectedSpecies
                        Button {
                            selectAlternative(candidate)
                        } label: {
                            HStack {
                                Text(getDisplayName(candidate.species))
                                    .font(.subheadline)
                                    .foregroundStyle(Color.foregroundText)
                                Spacer()
                                Text("\(Int(candidate.confidence * 100))%")
                                    .font(.subheadline.monospacedDigit())
                                    .foregroundStyle(Color.mutedText)
                            }
                            .padding(.vertical, 8)
                            .padding(.horizontal, 10)
                            .background(isSelected ? Color.accentColor.opacity(0.1) : Color.mutedText.opacity(0.06))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .strokeBorder(isSelected ? Color.accentColor : Color.clear, lineWidth: 1)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    /// Bottom action row: Back, Re-crop, Skip.
    private var bottomActions: some View {
        HStack(spacing: 8) {
            if photoIndex > 0 {
                Button {
                    viewModel.goBackToPreviousPhoto()
                } label: {
                    Label("Back", systemImage: "arrow.left")
                        .font(.subheadline)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.mutedText)
            }

            Spacer()

            Button {
                viewModel.requestManualCrop()
            } label: {
                Label("Re-crop", systemImage: "crop")
                    .font(.subheadline)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)

            Button {
                viewModel.skipCurrentPhoto()
            } label: {
                Label("Skip", systemImage: "forward.fill")
                    .font(.subheadline)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.mutedText)
        }
    }

    // MARK: - Helpers

    /// Confidence bar and percentage color based on threshold.
    private var confidenceColor: Color {
        if confidencePercent >= 80 { return .green }
        if confidencePercent >= 50 { return .orange }
        return .red
    }

    /// Initialize selection state when the view appears or the photo changes.
    private func initializeSelection() {
        showAlternatives = false
        if let top = candidates.first {
            selectedSpecies = top.species
            selectedConfidence = top.confidence
        } else {
            selectedSpecies = ""
            selectedConfidence = 0
        }
        fetchWikiImage()
    }

    /// Select an alternative candidate species.
    private func selectAlternative(_ candidate: IdentifiedCandidate) {
        selectedSpecies = candidate.species
        selectedConfidence = candidate.confidence
        fetchWikiImage()
    }

    /// Confirm the selected species with the given certainty status.
    private func confirmWith(status: ObservationStatus) {
        viewModel.confirmCurrentPhoto(
            species: selectedSpecies,
            confidence: selectedConfidence,
            status: status,
            count: 1
        )
    }

    /// Fetch the Wikipedia thumbnail image for the selected species.
    private func fetchWikiImage() {
        let species = selectedSpecies
        guard !species.isEmpty else {
            wikiImageURL = nil
            return
        }

        // Use wikiTitle if available from AI candidate, otherwise derive from species name
        let wikiTitle: String
        if let candidate = candidates.first(where: { $0.species == species }), let title = candidate.wikiTitle {
            wikiTitle = title
        } else {
            // Derive from display name, replacing spaces with underscores
            wikiTitle = getDisplayName(species).replacingOccurrences(of: " ", with: "_")
        }

        isLoadingWikiImage = true
        wikiImageURL = nil

        Task {
            defer { isLoadingWikiImage = false }
            do {
                let encodedTitle = wikiTitle.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? wikiTitle
                guard let url = URL(string: "https://en.wikipedia.org/api/rest_v1/page/summary/\(encodedTitle)") else { return }
                var request = URLRequest(url: url)
                request.setValue("WingDex-iOS/1.0", forHTTPHeaderField: "User-Agent")

                let (data, _) = try await URLSession.shared.data(for: request)
                let summary = try JSONDecoder().decode(WikiSummary.self, from: data)
                if let src = summary.thumbnail?.source, let imgURL = URL(string: src) {
                    wikiImageURL = imgURL
                }
            } catch {
                log.debug("Wiki image fetch failed for \(species): \(error.localizedDescription)")
            }
        }
    }
}

// MARK: - Wiki API Models

/// Decoded Wikipedia REST API summary response (subset).
private struct WikiSummary: Codable {
    let thumbnail: WikiThumbnail?

    struct WikiThumbnail: Codable {
        let source: String?
    }
}

// MARK: - Photo Progress Dots

/// Horizontal row of dots showing progress through the per-photo loop.
/// Green = confirmed, accent = current, muted = remaining.
struct PhotoProgressDots: View {
    let current: Int
    let total: Int

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<total, id: \.self) { index in
                Circle()
                    .fill(dotColor(for: index))
                    .frame(width: 8, height: 8)
            }
        }
    }

    private func dotColor(for index: Int) -> Color {
        if index < current { return .green }
        if index == current { return Color.accentColor }
        return Color.mutedText.opacity(0.3)
    }
}

// MARK: - Previews

#Preview("High Confidence") {
    let vm = AddPhotosViewModel()
    PerPhotoConfirmView(viewModel: vm)
        .onAppear {
            // Three photos in the cluster, currently on the second one
            vm.clusters = [PhotoCluster(
                photos: [
                    ProcessedPhoto(id: "p1", image: Data(), thumbnail: Data(),
                                   exifTime: Date().addingTimeInterval(-600),
                                   gpsLat: 47.6, gpsLon: -122.4,
                                   fileHash: "abc1", fileName: "eagle1.jpg"),
                    ProcessedPhoto(id: "p2", image: Data(), thumbnail: Data(),
                                   exifTime: Date().addingTimeInterval(-300),
                                   gpsLat: 47.6, gpsLon: -122.4,
                                   fileHash: "abc2", fileName: "eagle2.jpg"),
                    ProcessedPhoto(id: "p3", image: Data(), thumbnail: Data(),
                                   exifTime: Date(),
                                   gpsLat: 47.6, gpsLon: -122.4,
                                   fileHash: "abc3", fileName: "sparrow.jpg"),
                ],
                startTime: Date().addingTimeInterval(-600), endTime: Date(),
                centerLat: 47.6, centerLon: -122.4
            )]
            vm.currentPhotoIndex = 1  // Second photo
            vm.photoResults = [PhotoResult(
                photoId: "p1", species: "Bald Eagle (Haliaeetus leucocephalus)",
                confidence: 0.95, status: .confirmed, count: 1
            )]
            vm.currentCandidates = [
                IdentifiedCandidate(species: "Bald Eagle (Haliaeetus leucocephalus)", confidence: 0.92, wikiTitle: "Bald_eagle"),
                IdentifiedCandidate(species: "Golden Eagle (Aquila chrysaetos)", confidence: 0.06, wikiTitle: "Golden_eagle"),
            ]
        }
}

#Preview("Low Confidence") {
    let vm = AddPhotosViewModel()
    PerPhotoConfirmView(viewModel: vm)
        .onAppear {
            vm.clusters = [PhotoCluster(
                photos: [
                    ProcessedPhoto(id: "p1", image: Data(), thumbnail: Data(),
                                   exifTime: Date(), gpsLat: nil, gpsLon: nil,
                                   fileHash: "abc", fileName: "red_bird.jpg"),
                ],
                startTime: Date(), endTime: Date(),
                centerLat: nil, centerLon: nil
            )]
            vm.currentCandidates = [
                IdentifiedCandidate(species: "Northern Cardinal (Cardinalis cardinalis)", confidence: 0.55, wikiTitle: nil),
                IdentifiedCandidate(species: "Vermilion Flycatcher (Pyrocephalus rubinus)", confidence: 0.30, wikiTitle: nil),
                IdentifiedCandidate(species: "Summer Tanager (Piranga rubra)", confidence: 0.10, wikiTitle: nil),
            ]
        }
}

#Preview("No Candidates") {
    let vm = AddPhotosViewModel()
    PerPhotoConfirmView(viewModel: vm)
        .onAppear {
            vm.clusters = [PhotoCluster(
                photos: [
                    ProcessedPhoto(id: "p1", image: Data(), thumbnail: Data(),
                                   exifTime: nil, gpsLat: nil, gpsLon: nil,
                                   fileHash: "abc", fileName: "unknown.jpg"),
                    ProcessedPhoto(id: "p2", image: Data(), thumbnail: Data(),
                                   exifTime: nil, gpsLat: nil, gpsLon: nil,
                                   fileHash: "def", fileName: "tree.jpg"),
                ],
                startTime: Date(), endTime: Date(),
                centerLat: nil, centerLon: nil
            )]
            vm.currentCandidates = []
        }
}
