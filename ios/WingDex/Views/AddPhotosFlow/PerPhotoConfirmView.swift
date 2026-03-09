import SwiftUI
import os

private let log = Logger(subsystem: "app.wingdex", category: "PerPhotoConfirm")

/// Per-photo species confirmation view in the Add Photos flow.
///
/// iOS-native design: hero photo at top with Wikipedia reference inset,
/// species info card with glass material, and system-style action buttons.
/// Back/Crop/Skip are toolbar items rather than inline buttons.
struct PerPhotoConfirmView: View {
    @Bindable var viewModel: AddPhotosViewModel

    // MARK: - Local State

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
        VStack(spacing: 0) {
            if candidates.isEmpty {
                noCandidatesView
            } else {
                candidateConfirmView
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.pageBg.ignoresSafeArea())
        .toolbar {
            // Secondary actions in the toolbar - iOS-native pattern
            ToolbarItemGroup(placement: .bottomBar) {
                if photoIndex > 0 {
                    Button("Back", systemImage: "chevron.left") {
                        viewModel.goBackToPreviousPhoto()
                    }
                }
                Spacer()
                // Photo dots as a compact indicator
                PhotoProgressDots(current: photoIndex, total: totalPhotos)
                Spacer()
                Menu {
                    Button("Re-crop Photo", systemImage: "crop") {
                        viewModel.requestManualCrop()
                    }
                    Button("Skip Photo", systemImage: "forward.fill", role: .destructive) {
                        viewModel.skipCurrentPhoto()
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .onAppear { initializeSelection() }
        .onChange(of: viewModel.currentPhotoIndex) { initializeSelection() }
        .onChange(of: viewModel.currentCandidates.count) { initializeSelection() }
    }

    // MARK: - No Candidates

    private var noCandidatesView: some View {
        VStack(spacing: 24) {
            Spacer()

            // Photo
            heroPhoto
                .frame(maxHeight: 240)

            Image(systemName: "questionmark.circle")
                .font(.system(size: 40))
                .foregroundStyle(Color.mutedText)

            Text("No bird species identified")
                .font(.headline)
                .foregroundStyle(Color.foregroundText)

            Text("Try cropping to isolate the bird, or skip this photo.")
                .font(.subheadline)
                .foregroundStyle(Color.mutedText)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            HStack(spacing: 16) {
                Button {
                    viewModel.requestManualCrop()
                } label: {
                    Label("Crop & Retry", systemImage: "crop")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color.accentColor)

                Button(role: .destructive) {
                    viewModel.skipCurrentPhoto()
                } label: {
                    Text("Skip")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.bordered)
            }
            .padding(.horizontal, 24)

            Spacer()
        }
    }

    // MARK: - Candidate Confirmation

    private var candidateConfirmView: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Hero photo with wiki reference inset
                ZStack(alignment: .bottomTrailing) {
                    heroPhoto
                        .frame(maxHeight: 280)

                    // Wikipedia reference as a small inset overlay
                    wikiReferenceInset
                        .padding(8)
                }

                // Species identification card
                VStack(alignment: .leading, spacing: 12) {
                    // Species name + confidence
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(displayName)
                                .font(.title2.weight(.semibold))
                            if let sci = scientificName {
                                Text(sci)
                                    .font(.subheadline.italic())
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        Text("\(confidencePercent)%")
                            .font(.system(.title, design: .rounded, weight: .semibold).monospacedDigit())
                            .foregroundStyle(confidenceColor)
                    }

                    // Native confidence bar
                    ProgressView(value: selectedConfidence)
                        .tint(confidenceColor)

                    // Primary action buttons
                    if isHighConfidence && !showAlternatives {
                        highConfidenceActions
                    } else {
                        lowConfidenceActions
                    }
                }
                .padding(20)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
                .padding(.horizontal, 16)
            }
        }
    }

    // MARK: - Hero Photo

    private var heroPhoto: some View {
        Group {
            if let photo, let uiImage = UIImage(data: photo.thumbnail) {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFit()
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            } else {
                RoundedRectangle(cornerRadius: 12)
                    .fill(.regularMaterial)
                    .overlay {
                        Image(systemName: "photo")
                            .font(.largeTitle)
                            .foregroundStyle(.tertiary)
                    }
            }
        }
        .padding(.horizontal, 16)
    }

    // MARK: - Wiki Reference Inset

    /// Small Wikipedia reference thumbnail overlaid on the hero photo's corner.
    private var wikiReferenceInset: some View {
        Group {
            if let url = wikiImageURL {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                            .frame(width: 64, height: 64)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .strokeBorder(.white, lineWidth: 2)
                            )
                            .shadow(radius: 4)
                    default:
                        EmptyView()
                    }
                }
            } else {
                EmptyView()
            }
        }
    }

    // MARK: - Actions

    private var highConfidenceActions: some View {
        VStack(spacing: 10) {
            Label("High confidence", systemImage: "checkmark.seal.fill")
                .font(.subheadline)
                .foregroundStyle(.green)

            Button {
                confirmWith(status: .confirmed)
            } label: {
                HStack {
                    Image(systemName: "checkmark.circle.fill")
                    Text("Confirm")
                    if photoIndex < totalPhotos - 1 {
                        Image(systemName: "chevron.right")
                            .font(.caption)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 48)
            }
            .buttonStyle(.borderedProminent)
            .tint(Color.accentColor)
            .sensoryFeedback(.success, trigger: photoIndex)

            if candidates.count > 1 {
                Button("Show \(candidates.count - 1) alternative\(candidates.count > 2 ? "s" : "")") {
                    showAlternatives = true
                }
                .font(.subheadline)
                .foregroundStyle(Color.accentColor)
            }
        }
    }

    private var lowConfidenceActions: some View {
        VStack(spacing: 12) {
            HStack(spacing: 10) {
                Button {
                    confirmWith(status: .confirmed)
                } label: {
                    Label("Confirm", systemImage: "checkmark.circle")
                        .frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color.accentColor)

                Button {
                    confirmWith(status: .possible)
                } label: {
                    Label("Possible", systemImage: "questionmark.circle")
                        .frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.bordered)
            }

            // Candidate alternatives as a native picker-style list
            if candidates.count > 1 {
                VStack(alignment: .leading, spacing: 6) {
                    Text("All candidates")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)

                    ForEach(candidates, id: \.species) { candidate in
                        let isSelected = candidate.species == selectedSpecies
                        Button {
                            selectAlternative(candidate)
                        } label: {
                            HStack {
                                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(isSelected ? Color.accentColor : Color.secondary.opacity(0.4))
                                Text(getDisplayName(candidate.species))
                                    .foregroundStyle(Color.foregroundText)
                                Spacer()
                                Text("\(Int(candidate.confidence * 100))%")
                                    .monospacedDigit()
                                    .foregroundStyle(.secondary)
                            }
                            .font(.subheadline)
                            .padding(.vertical, 6)
                        }
                        .buttonStyle(.plain)
                        if candidate.species != candidates.last?.species {
                            Divider()
                        }
                    }
                }
            }
        }
    }

    // MARK: - Helpers

    private var confidenceColor: Color {
        if confidencePercent >= 80 { return .green }
        if confidencePercent >= 50 { return .orange }
        return .red
    }

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

    private func selectAlternative(_ candidate: IdentifiedCandidate) {
        selectedSpecies = candidate.species
        selectedConfidence = candidate.confidence
        fetchWikiImage()
    }

    private func confirmWith(status: ObservationStatus) {
        viewModel.confirmCurrentPhoto(
            species: selectedSpecies,
            confidence: selectedConfidence,
            status: status,
            count: 1
        )
    }

    private func fetchWikiImage() {
        let species = selectedSpecies
        guard !species.isEmpty else {
            wikiImageURL = nil
            return
        }

        let wikiTitle: String
        if let candidate = candidates.first(where: { $0.species == species }), let title = candidate.wikiTitle {
            wikiTitle = title
        } else {
            wikiTitle = getDisplayName(species).replacingOccurrences(of: " ", with: "_")
        }

        isLoadingWikiImage = true
        wikiImageURL = nil

        Task {
            defer { isLoadingWikiImage = false }
            do {
                let encoded = wikiTitle.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? wikiTitle
                guard let url = URL(string: "https://en.wikipedia.org/api/rest_v1/page/summary/\(encoded)") else { return }
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

// MARK: - Wiki API

private struct WikiSummary: Codable {
    let thumbnail: WikiThumbnail?
    struct WikiThumbnail: Codable {
        let source: String?
    }
}

// MARK: - Photo Progress Dots

struct PhotoProgressDots: View {
    let current: Int
    let total: Int

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<total, id: \.self) { index in
                Circle()
                    .fill(index < current ? .green : index == current ? Color.accentColor : Color.secondary.opacity(0.3))
                    .frame(width: 8, height: 8)
            }
        }
    }
}

// MARK: - Previews

#Preview("High Confidence") {
    NavigationStack {
        let vm = AddPhotosViewModel()
        PerPhotoConfirmView(viewModel: vm)
            .onAppear {
                vm.clusters = [PreviewData.sampleCluster(photoCount: 3)]
                vm.currentPhotoIndex = 1
                vm.photoResults = [PhotoResult(
                    photoId: "preview-0", species: "Bald Eagle (Haliaeetus leucocephalus)",
                    confidence: 0.95, status: .confirmed, count: 1
                )]
                vm.currentCandidates = [
                    IdentifiedCandidate(species: "Bald Eagle (Haliaeetus leucocephalus)", confidence: 0.92, wikiTitle: "Bald_eagle"),
                    IdentifiedCandidate(species: "Golden Eagle (Aquila chrysaetos)", confidence: 0.06, wikiTitle: "Golden_eagle"),
                ]
            }
    }
}

#Preview("Low Confidence") {
    NavigationStack {
        let vm = AddPhotosViewModel()
        PerPhotoConfirmView(viewModel: vm)
            .onAppear {
                vm.clusters = [PreviewData.sampleCluster(photoCount: 1, lat: nil, lon: nil)]
                vm.currentCandidates = [
                    IdentifiedCandidate(species: "Northern Cardinal (Cardinalis cardinalis)", confidence: 0.55, wikiTitle: "Northern_cardinal"),
                    IdentifiedCandidate(species: "Vermilion Flycatcher (Pyrocephalus rubinus)", confidence: 0.30, wikiTitle: "Vermilion_flycatcher"),
                    IdentifiedCandidate(species: "Summer Tanager (Piranga rubra)", confidence: 0.10, wikiTitle: "Summer_tanager"),
                ]
            }
    }
}

#Preview("No Candidates") {
    NavigationStack {
        let vm = AddPhotosViewModel()
        PerPhotoConfirmView(viewModel: vm)
            .onAppear {
                vm.clusters = [PreviewData.sampleCluster(photoCount: 2, lat: nil, lon: nil)]
                vm.currentCandidates = []
            }
    }
}
