import SwiftUI
import os

private let log = Logger(subsystem: "app.wingdex", category: "PerPhotoConfirm")

/// Per-photo species confirmation view.
///
/// Toolbar layout:
/// - Top left: X (cancel wizard with confirmation)
/// - Top right: primary action icon (checkmark or forward)
/// - Bottom left: back chevron (if not first photo)
/// - Bottom right: secondary tools (crop, possible, skip)
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

// MARK: - Body

    var body: some View {
        VStack(spacing: 0) {
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
            // Primary action top-right (adapts icon by context)
            ToolbarItemGroup(placement: .primaryAction) {
                Button("Possible", systemImage: "questionmark") {
                    confirmWith(status: .possible)
                }
                .disabled(selectedSpecies.isEmpty)                    
                Button("Confirm", systemImage: "checkmark") {
                    confirmWith(status: .confirmed)
                }
                .disabled(selectedSpecies.isEmpty)
            }
            // Bottom bar: back (left) + secondary tools (right of back)
            ToolbarItemGroup(placement: .bottomBar) {
                if photoIndex > 0 {
                    Button {
                        viewModel.goBackToPreviousPhoto()
                    } label: {
                        Image(systemName: "chevron.left")
                    }
                }

                Spacer()

                Button("Skip", role: .destructive) {
                    viewModel.skipCurrentPhoto()
                }

                Spacer()
                
                Button {
                    viewModel.requestManualCrop()
                } label: {
                    Image(systemName: "crop")
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
        GeometryReader { geo in
            let contentWidth = geo.size.width - 32
            let photoSize = (contentWidth - 12) / 2

            VStack(spacing: 0) {
                Spacer(minLength: 0)

                VStack(spacing: 16) {
                    HStack(spacing: 12) {
                        VStack(spacing: 6) {
                            aiCroppedUserPhoto(size: photoSize)
                            Text("Cropped photo")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .frame(width: photoSize)

                        VStack(spacing: 6) {
                            wikiSquareThumbnail(size: photoSize)
                            Text("Wikipedia Reference")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .frame(width: photoSize)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 16)

                    speciesCard
                }

                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    // MARK: - AI-Cropped Square User Photo

    private func aiCroppedUserPhoto(size: CGFloat) -> some View {
        Group {
            if let croppedData = photo?.croppedImage,
               let croppedImage = UIImage(data: croppedData) {
                Image(uiImage: croppedImage)
                    .resizable()
                    .scaledToFill()
                    .frame(width: size, height: size)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            } else if let photo, let cropBox = photo.aiCropBox,
                      let previewImage = aiPreviewImage(from: photo.image, cropBox: cropBox) {
                Image(uiImage: previewImage)
                    .resizable()
                    .scaledToFill()
                    .frame(width: size, height: size)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            } else {
                fallbackPhoto(size: size)
            }
        }
    }

    private func aiPreviewImage(from imageData: Data, cropBox: CropBoxResult) -> UIImage? {
        guard let uiImage = UIImage(data: imageData) else { return nil }
        let uprightImage = uiImage.imageOrientation == .up
            ? uiImage
            : UIGraphicsImageRenderer(size: uiImage.size).image { _ in
                uiImage.draw(in: CGRect(origin: .zero, size: uiImage.size))
            }
        guard let cgImage = uprightImage.cgImage else { return nil }

        let padded = CropService.paddedSquareCrop(
            from: CropService.CropBox(x: cropBox.x, y: cropBox.y, width: cropBox.width, height: cropBox.height),
            naturalWidth: Double(cgImage.width),
            naturalHeight: Double(cgImage.height)
        )
        let sx = max(0, min(Int(padded.x.rounded(.down)), cgImage.width - 1))
        let sy = max(0, min(Int(padded.y.rounded(.down)), cgImage.height - 1))
        let sw = max(1, min(Int(padded.width.rounded(.down)), cgImage.width - sx))
        let sh = max(1, min(Int(padded.height.rounded(.down)), cgImage.height - sy))

        guard let cropped = cgImage.cropping(to: CGRect(x: sx, y: sy, width: sw, height: sh)) else {
            return nil
        }
        return UIImage(cgImage: cropped)
    }

    private func fallbackPhoto(size: CGFloat) -> some View {
        Group {
            if let photo, let uiImage = UIImage(data: photo.thumbnail) {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFill()
                    .frame(width: size, height: size)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            } else {
                RoundedRectangle(cornerRadius: 12)
                    .fill(.regularMaterial)
                    .frame(width: size, height: size)
                    .overlay {
                        Image(systemName: "photo")
                            .font(.title2)
                            .foregroundStyle(.tertiary)
                    }
            }
        }
    }

    // MARK: - Wiki Square Thumbnail (portrait-aware)

    private func wikiSquareThumbnail(size: CGFloat) -> some View {
        Group {
            if let url = wikiImageURL?.absoluteString {
                BirdThumbnail(url: url, size: size, cornerRadius: 12)
            } else if isLoadingWikiImage {
                wikiPlaceholder(size: size)
                    .overlay { ProgressView() }
            } else {
                wikiPlaceholder(size: size)
            }
        }
    }

    private func wikiPlaceholder(size: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 12)
            .fill(.regularMaterial)
            .frame(width: size, height: size)
            .overlay {
                Image(systemName: "bird")
                    .font(.title2)
                    .foregroundStyle(.tertiary)
            }
    }

    // MARK: - Species Card

    private var speciesCard: some View {
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
                    .font(.system(.title2, weight: .bold).monospacedDigit())
                    .foregroundStyle(confidenceColor)
            }

            ProgressView(value: selectedConfidence)
                .tint(confidenceColor)

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
        } else { selectedSpecies = ""; selectedConfidence = 0 }
        fetchWikiImage()
    }

    private func selectAlternative(_ candidate: IdentifiedCandidate) {
        selectedSpecies = candidate.species
        selectedConfidence = candidate.confidence
        fetchWikiImage()
    }

    private func confirmWith(status: ObservationStatus) {
        viewModel.confirmCurrentPhoto(species: selectedSpecies, confidence: selectedConfidence, status: status, count: 1)
    }

    private func fetchWikiImage() {
        let species = selectedSpecies
        guard !species.isEmpty else { wikiImageURL = nil; return }
        let wikiTitle: String
        if let c = candidates.first(where: { $0.species == species }), let t = c.wikiTitle { wikiTitle = t }
        else { wikiTitle = getDisplayName(species).replacingOccurrences(of: " ", with: "_") }
        isLoadingWikiImage = true; wikiImageURL = nil
        Task {
            defer { isLoadingWikiImage = false }
            do {
                let enc = wikiTitle.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? wikiTitle
                guard let url = URL(string: "https://en.wikipedia.org/api/rest_v1/page/summary/\(enc)") else { return }
                var req = URLRequest(url: url); req.setValue("WingDex-iOS/1.0", forHTTPHeaderField: "User-Agent")
                let (data, _) = try await URLSession.shared.data(for: req)
                struct S: Codable { let thumbnail: T?; struct T: Codable { let source: String? } }
                let s = try JSONDecoder().decode(S.self, from: data)
                if let src = s.thumbnail?.source, let u = URL(string: src) { wikiImageURL = u }
            } catch { log.debug("Wiki fetch failed: \(error.localizedDescription)") }
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
                vm.clusters = [PreviewData.sampleCluster(photoCount: 5)]
                vm.currentPhotoIndex = 2
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

#Preview("Canvas Selection") {
    let vm = AddPhotosViewModel()
    PerPhotoConfirmView(viewModel: vm)
        .frame(width: 390, height: 760)
        .background(Color.pageBg)
        .onAppear {
            vm.clusters = [PreviewData.sampleCluster(photoCount: 5)]
            vm.currentPhotoIndex = 2
            vm.currentCandidates = [
                IdentifiedCandidate(species: "Northern Cardinal (Cardinalis cardinalis)", confidence: 0.55, wikiTitle: "Northern_cardinal"),
                IdentifiedCandidate(species: "Vermilion Flycatcher (Pyrocephalus rubinus)", confidence: 0.30, wikiTitle: "Vermilion_flycatcher"),
                IdentifiedCandidate(species: "Summer Tanager (Piranga rubra)", confidence: 0.10, wikiTitle: "Summer_tanager"),
            ]
        }
}
