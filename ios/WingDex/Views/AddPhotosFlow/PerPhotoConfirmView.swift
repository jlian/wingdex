import SwiftUI
import os

private let log = Logger(subsystem: "app.wingdex", category: "PerPhotoConfirm")

/// Per-photo species confirmation view in the Add Photos flow.
///
/// Shows the user's photo and a Wikipedia reference side by side for visual
/// comparison. Species name, confidence bar, and Confirm/Possible actions
/// in a card below. Secondary actions (crop, skip) in the navigation toolbar.
/// Bottom toolbar has consistent Back / Dots / Confirm pattern.
struct PerPhotoConfirmView: View {
    @Bindable var viewModel: AddPhotosViewModel

    @State private var selectedSpecies = ""
    @State private var selectedConfidence: Double = 0
    @State private var showAlternatives = false
    @State private var wikiImageURL: URL?
    @State private var isLoadingWikiImage = false

    private var photo: ProcessedPhoto? { viewModel.currentPhoto }
    private var candidates: [IdentifiedCandidate] { viewModel.currentCandidates }
    private var photoIndex: Int { viewModel.currentPhotoIndex }
    private var totalPhotos: Int { viewModel.clusterPhotos.count }
    private var isHighConfidence: Bool { selectedConfidence >= 0.8 }
    private var confidencePercent: Int { Int(selectedConfidence * 100) }
    private var displayName: String { getDisplayName(selectedSpecies) }
    private var scientificName: String? { getScientificName(selectedSpecies) }

    var body: some View {
        Group {
            if candidates.isEmpty {
                noCandidatesView
            } else {
                candidateConfirmView
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.pageBg.ignoresSafeArea())
        .navigationTitle("Photo \(photoIndex + 1) of \(totalPhotos)")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // Secondary actions in nav bar
            ToolbarItemGroup(placement: .primaryAction) {
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
            // Liquid glass bottom bar: Back / Dots / Confirm
            ToolbarItemGroup(placement: .bottomBar) {
                Button {
                    viewModel.goBackToPreviousPhoto()
                } label: {
                    Image(systemName: "chevron.left")
                }
                .disabled(photoIndex == 0)

                Spacer()

                PhotoProgressDots(current: photoIndex, total: totalPhotos)

                Spacer()

                Button {
                    confirmWith(status: .confirmed)
                } label: {
                    Label("Confirm", systemImage: "checkmark.circle.fill")
                }
                .disabled(selectedSpecies.isEmpty)
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

            if let photo, let uiImage = UIImage(data: photo.thumbnail) {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFit()
                    .frame(maxHeight: 200)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .padding(.horizontal, 40)
            }

            Image(systemName: "questionmark.circle")
                .font(.system(size: 40))
                .foregroundStyle(.secondary)

            Text("No bird species identified")
                .font(.headline)

            Text("Try cropping to isolate the bird, or skip this photo.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            Button {
                viewModel.requestManualCrop()
            } label: {
                Label("Crop & Retry", systemImage: "crop")
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .tint(Color.accentColor)
            .padding(.horizontal, 40)

            Spacer()
        }
    }

    // MARK: - Candidate Confirmation

    private var candidateConfirmView: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Side-by-side photo comparison - equal weight
                HStack(spacing: 12) {
                    // User's photo
                    VStack(spacing: 6) {
                        if let photo, let uiImage = UIImage(data: photo.thumbnail) {
                            Image(uiImage: uiImage)
                                .resizable()
                                .scaledToFill()
                                .frame(minWidth: 0, maxWidth: .infinity)
                                .aspectRatio(1, contentMode: .fill)
                                .clipped()
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                        } else {
                            RoundedRectangle(cornerRadius: 12)
                                .fill(.regularMaterial)
                                .aspectRatio(1, contentMode: .fill)
                                .overlay {
                                    Image(systemName: "photo")
                                        .font(.title2)
                                        .foregroundStyle(.tertiary)
                                }
                        }
                        Text("Your photo")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    // Wikipedia reference
                    VStack(spacing: 6) {
                        wikiReferenceImage
                        Text("Reference")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal, 16)

                // Species identification card
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(displayName)
                                .font(.title3.weight(.semibold))
                            if let sci = scientificName {
                                Text(sci)
                                    .font(.subheadline.italic())
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        Text("\(confidencePercent)%")
                            .font(.system(.title2, design: .rounded, weight: .bold).monospacedDigit())
                            .foregroundStyle(confidenceColor)
                    }

                    ProgressView(value: selectedConfidence)
                        .tint(confidenceColor)

                    // Inline actions
                    if isHighConfidence && !showAlternatives {
                        highConfidenceInline
                    } else {
                        lowConfidenceInline
                    }
                }
                .padding(16)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
                .padding(.horizontal, 16)
            }
            .padding(.top, 8)
        }
    }

    // MARK: - Wiki Reference Image

    private var wikiReferenceImage: some View {
        Group {
            if let url = wikiImageURL {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                            .frame(minWidth: 0, maxWidth: .infinity)
                            .aspectRatio(1, contentMode: .fill)
                            .clipped()
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                    case .failure:
                        wikiPlaceholder
                    default:
                        wikiPlaceholder
                            .overlay { ProgressView() }
                    }
                }
            } else if isLoadingWikiImage {
                wikiPlaceholder
                    .overlay { ProgressView() }
            } else {
                wikiPlaceholder
            }
        }
    }

    private var wikiPlaceholder: some View {
        RoundedRectangle(cornerRadius: 12)
            .fill(.regularMaterial)
            .aspectRatio(1, contentMode: .fill)
            .overlay {
                Image(systemName: "bird")
                    .font(.title2)
                    .foregroundStyle(.tertiary)
            }
    }

    // MARK: - High Confidence

    private var highConfidenceInline: some View {
        VStack(spacing: 8) {
            Label("High confidence", systemImage: "checkmark.seal.fill")
                .font(.subheadline)
                .foregroundStyle(.green)

            if candidates.count > 1 {
                Button("Show \(candidates.count - 1) alternative\(candidates.count > 2 ? "s" : "")") {
                    showAlternatives = true
                }
                .font(.subheadline)
            }

            // "Possible" for when user isn't sure even if AI is confident
            Button {
                confirmWith(status: .possible)
            } label: {
                Label("Mark as Possible Instead", systemImage: "questionmark.circle")
                    .font(.subheadline)
            }
            .foregroundStyle(.secondary)
        }
    }

    // MARK: - Low Confidence

    private var lowConfidenceInline: some View {
        VStack(spacing: 12) {
            // Possible button (Confirm is in the bottom bar)
            Button {
                confirmWith(status: .possible)
            } label: {
                Label("Possible", systemImage: "questionmark.circle")
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.bordered)

            // Candidate alternatives
            if candidates.count > 1 {
                VStack(alignment: .leading, spacing: 4) {
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
        guard !species.isEmpty else { wikiImageURL = nil; return }

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

private struct WikiSummary: Codable {
    let thumbnail: WikiThumbnail?
    struct WikiThumbnail: Codable { let source: String? }
}

struct PhotoProgressDots: View {
    let current: Int
    let total: Int
    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<total, id: \.self) { i in
                Circle()
                    .fill(i < current ? .green : i == current ? Color.accentColor : Color.secondary.opacity(0.3))
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
