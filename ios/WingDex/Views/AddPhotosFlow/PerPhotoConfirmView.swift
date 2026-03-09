import SwiftUI
import os

private let log = Logger(subsystem: "app.wingdex", category: "PerPhotoConfirm")

/// Per-photo species confirmation view.
///
/// Photos app-style toolbar layout:
/// - Top left: back, Top right: (from AddPhotosFlow cancel)
/// - Bottom left: progress dots
/// - Bottom center: secondary actions (crop, skip, possible)
/// - Bottom right: primary action (Confirm)
struct PerPhotoConfirmView: View {
    @Bindable var viewModel: AddPhotosViewModel

    @State private var selectedSpecies = ""
    @State private var selectedConfidence: Double = 0
    @State private var wikiImageURL: URL?
    @State private var isLoadingWikiImage = false

    private var photo: ProcessedPhoto? { viewModel.currentPhoto }
    private var candidates: [IdentifiedCandidate] { viewModel.currentCandidates }
    private var photoIndex: Int { viewModel.currentPhotoIndex }
    private var totalPhotos: Int { viewModel.clusterPhotos.count }
    private var confidencePercent: Int { Int(selectedConfidence * 100) }
    private var displayName: String { getDisplayName(selectedSpecies) }
    private var scientificName: String? { getScientificName(selectedSpecies) }
    private var hasCandidates: Bool { !candidates.isEmpty }

    var body: some View {
        Group {
            if hasCandidates {
                candidateView
            } else {
                noCandidatesView
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.pageBg.ignoresSafeArea())
        .navigationTitle("Photo \(photoIndex + 1) of \(totalPhotos)")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // Back in top-left
            ToolbarItem(placement: .navigation) {
                if photoIndex > 0 {
                    Button {
                        viewModel.goBackToPreviousPhoto()
                    } label: {
                        Image(systemName: "chevron.left")
                    }
                }
            }
            // Bottom bar: dots (left) | tools (center) | primary (right)
            ToolbarItemGroup(placement: .bottomBar) {
                // Progress dots (left)
                PhotoProgressDots(current: photoIndex, total: totalPhotos)

                Spacer()

                if hasCandidates {
                    // Center tools: crop, possible, skip
                    Button("Crop", systemImage: "crop") {
                        viewModel.requestManualCrop()
                    }
                    Button("Possible", systemImage: "questionmark.circle") {
                        confirmWith(status: .possible)
                    }
                    .disabled(selectedSpecies.isEmpty)
                    Button("Skip", systemImage: "forward.fill") {
                        viewModel.skipCurrentPhoto()
                    }

                    Spacer()

                    // Primary: Confirm (right)
                    Button {
                        confirmWith(status: .confirmed)
                    } label: {
                        Label("Confirm", systemImage: "chevron.right")
                            .labelStyle(.titleAndIcon)
                    }
                    .disabled(selectedSpecies.isEmpty)
                } else {
                    // No candidates: crop center, skip right
                    Button("Crop", systemImage: "crop") {
                        viewModel.requestManualCrop()
                    }

                    Spacer()

                    Button {
                        viewModel.skipCurrentPhoto()
                    } label: {
                        Label("Skip", systemImage: "chevron.right")
                            .labelStyle(.titleAndIcon)
                    }
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

            if let photo, let uiImage = UIImage(data: photo.thumbnail) {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFit()
                    .frame(maxHeight: 220)
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

            Spacer()
        }
    }

    // MARK: - Candidate View

    private var candidateView: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Side-by-side photos - fixed height, not aspect ratio fill
                HStack(alignment: .top, spacing: 12) {
                    VStack(spacing: 6) {
                        userPhotoImage
                        Text("Your photo")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)

                    VStack(spacing: 6) {
                        wikiReferenceImage
                        Text("Reference")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                }
                .padding(.horizontal, 16)

                // Species info card
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

                    if selectedConfidence >= 0.8 {
                        Label("High confidence", systemImage: "checkmark.seal.fill")
                            .font(.subheadline)
                            .foregroundStyle(.green)
                    }

                    if candidates.count > 1 {
                        Divider()
                        Text("All candidates")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.secondary)
                            .textCase(.uppercase)
                        ForEach(candidates, id: \.species) { candidate in
                            candidateRow(candidate)
                        }
                    }
                }
                .padding(16)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
                .padding(.horizontal, 16)
            }
            .padding(.top, 8)
        }
    }

    private func candidateRow(_ candidate: IdentifiedCandidate) -> some View {
        let isSelected = candidate.species == selectedSpecies
        return Button {
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
            .padding(.vertical, 4)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Photos (fixed height, scaledToFit to avoid clipping)

    private var userPhotoImage: some View {
        Group {
            if let photo, let uiImage = UIImage(data: photo.thumbnail) {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFit()
                    .frame(height: 160)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            } else {
                imagePlaceholder(systemName: "photo")
            }
        }
    }

    private var wikiReferenceImage: some View {
        Group {
            if let url = wikiImageURL {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFit()
                            .frame(height: 160)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                    case .failure:
                        imagePlaceholder(systemName: "bird")
                    default:
                        imagePlaceholder(systemName: "bird")
                            .overlay { ProgressView() }
                    }
                }
            } else if isLoadingWikiImage {
                imagePlaceholder(systemName: "bird")
                    .overlay { ProgressView() }
            } else {
                imagePlaceholder(systemName: "bird")
            }
        }
    }

    private func imagePlaceholder(systemName: String) -> some View {
        RoundedRectangle(cornerRadius: 12)
            .fill(.regularMaterial)
            .frame(height: 160)
            .overlay {
                Image(systemName: systemName)
                    .font(.title2)
                    .foregroundStyle(.tertiary)
            }
    }

    // MARK: - Helpers

    private var confidenceColor: Color {
        if confidencePercent >= 80 { return .green }
        if confidencePercent >= 50 { return .orange }
        return .red
    }

    private func initializeSelection() {
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
            species: selectedSpecies, confidence: selectedConfidence,
            status: status, count: 1
        )
    }

    private func fetchWikiImage() {
        let species = selectedSpecies
        guard !species.isEmpty else { wikiImageURL = nil; return }
        let wikiTitle: String
        if let c = candidates.first(where: { $0.species == species }), let t = c.wikiTitle {
            wikiTitle = t
        } else {
            wikiTitle = getDisplayName(species).replacingOccurrences(of: " ", with: "_")
        }
        isLoadingWikiImage = true
        wikiImageURL = nil
        Task {
            defer { isLoadingWikiImage = false }
            do {
                let enc = wikiTitle.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? wikiTitle
                guard let url = URL(string: "https://en.wikipedia.org/api/rest_v1/page/summary/\(enc)") else { return }
                var req = URLRequest(url: url)
                req.setValue("WingDex-iOS/1.0", forHTTPHeaderField: "User-Agent")
                let (data, _) = try await URLSession.shared.data(for: req)
                struct Summary: Codable { let thumbnail: Thumb?; struct Thumb: Codable { let source: String? } }
                let s = try JSONDecoder().decode(Summary.self, from: data)
                if let src = s.thumbnail?.source, let u = URL(string: src) { wikiImageURL = u }
            } catch {
                log.debug("Wiki fetch failed: \(error.localizedDescription)")
            }
        }
    }
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
