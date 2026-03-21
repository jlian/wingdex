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
    @State private var wikiImageTask: Task<Void, Never>?
    @State private var galleryURLs: [URL] = []
    @State private var galleryTask: Task<Void, Never>?
    @State private var galleryIndex = 0

    private var photo: ProcessedPhoto? { viewModel.currentPhoto }
    private var candidates: [IdentifiedCandidate] { viewModel.currentCandidates }
    private var photoIndex: Int { viewModel.currentPhotoIndex }
    private var totalPhotos: Int { viewModel.clusterPhotos.count }
    private var confidencePercent: Int { Int(selectedConfidence * 100) }
    private var displayName: String { getDisplayName(selectedSpecies) }
    private var scientificName: String? { getScientificName(selectedSpecies) }
    private var selectedPlumage: String? { candidates.first { $0.species == selectedSpecies }?.plumage }

    private func plumageIcon(_ p: String) -> String? {
        let l = p.lowercased()
        if l.contains("juvenile") || l.contains("immature") || l.contains("chick") { return "\u{1F423}" }
        if l.contains("female") { return "\u{2640}" }
        if l.contains("male") { return "\u{2642}" }
        return nil
    }
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
            // Confirm action top-right (tinted green)
            ToolbarItem(placement: .primaryAction) {
                if hasCandidates {
                    Button {
                        confirmWith(status: .confirmed)
                    } label: {
                        Image(systemName: "checkmark")
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(selectedSpecies.isEmpty)
                } else {
                    Button("Skip", role: .destructive) {
                        viewModel.skipCurrentPhoto()
                    }
                }
            }
            // Bottom bar: back (left) + overflow menu (right)
            ToolbarItemGroup(placement: .bottomBar) {
                if photoIndex > 0 {
                    Button {
                        viewModel.goBackToPreviousPhoto()
                    } label: {
                        Image(systemName: "chevron.left")
                    }
                }

                Spacer()

                if hasCandidates {
                    Menu {
                        Button {
                            confirmWith(status: .possible)
                        } label: {
                            Label("Mark as Possible", systemImage: "questionmark")
                        }
                        .disabled(selectedSpecies.isEmpty)
                        Button {
                            viewModel.requestManualCrop()
                        } label: {
                            Label("Re-crop", systemImage: "crop")
                        }
                        Button(role: .destructive) {
                            viewModel.skipCurrentPhoto()
                        } label: {
                            Label("Skip Photo", systemImage: "forward")
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                    }
                } else {
                    Button("Re-crop") {
                        viewModel.requestManualCrop()
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

                    if viewModel.rangeAdjusted {
                        Link(destination: URL(string: "https://datazone.birdlife.org")!) {
                            Text("Location-filtered using BirdLife International.")
                                .font(.system(size: 10))
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity)
                    }
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

    // MARK: - Wiki Square Thumbnail (portrait-aware, swipeable gallery)

    /// All available image URLs: primary wiki image + gallery images.
    private var allWikiURLs: [URL] {
        var urls: [URL] = []
        if let u = wikiImageURL { urls.append(u) }
        urls.append(contentsOf: galleryURLs)
        return urls
    }

    private func wikiSquareThumbnail(size: CGFloat) -> some View {
        let urls = allWikiURLs
        let safeIndex = urls.isEmpty ? 0 : min(galleryIndex, urls.count - 1)

        return ZStack(alignment: .bottom) {
            if urls.isEmpty {
                if isLoadingWikiImage {
                    wikiPlaceholder(size: size)
                        .overlay { ProgressView() }
                } else {
                    wikiPlaceholder(size: size)
                }
            } else {
                TabView(selection: Binding(
                    get: { safeIndex },
                    set: { galleryIndex = $0 }
                )) {
                    ForEach(Array(urls.enumerated()), id: \.offset) { i, url in
                        BirdThumbnail(url: url.absoluteString, size: size, cornerRadius: 12)
                            .tag(i)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .frame(width: size, height: size)
            }

            // Dot indicators
            if urls.count > 1 {
                HStack(spacing: 4) {
                    ForEach(0..<urls.count, id: \.self) { i in
                        Circle()
                            .fill(i == safeIndex ? Color.white : Color.white.opacity(0.4))
                            .frame(width: 6, height: 6)
                    }
                }
                .padding(.bottom, 6)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 12))
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
                    HStack(spacing: 4) {
                        Text(displayName)
                            .font(.title3.weight(.semibold))
                        if let plumage = selectedPlumage, let icon = plumageIcon(plumage) {
                            Text(icon)
                                .font(.subheadline)
                                .accessibilityLabel(plumage)
                        }
                    }
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
                    .font(.body)
                    .foregroundStyle(isSelected ? Color.accentColor : Color.secondary.opacity(0.4))
                Text(getDisplayName(candidate.species))
                    .font(.body)
                if let plumage = candidate.plumage, let icon = plumageIcon(plumage) {
                    Text(icon)
                        .font(.caption)
                        .accessibilityLabel(plumage)
                }
                Spacer()
                if let range = candidate.rangeStatus, range == "out-of-range" || range == "near-range" {
                    Image(systemName: range == "out-of-range" ? "location.slash" : "location")
                        .font(.system(size: 10))
                        .foregroundStyle(range == "out-of-range" ? .red : .orange)
                }
                Text("\(Int(candidate.confidence * 100))%")
                    .font(.body.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            .padding(.vertical, 10)
            .padding(.horizontal, 4)
            .contentShape(Rectangle())
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
        wikiImageTask?.cancel()
        galleryTask?.cancel()
        galleryIndex = 0
        let species = selectedSpecies
        guard !species.isEmpty else { wikiImageURL = nil; galleryURLs = []; galleryIndex = 0; return }
        let wikiTitle: String
        if let c = candidates.first(where: { $0.species == species }), let t = c.wikiTitle { wikiTitle = t }
        else { wikiTitle = getDisplayName(species).replacingOccurrences(of: " ", with: "_") }
        isLoadingWikiImage = true; wikiImageURL = nil
        wikiImageTask = Task {
            do {
                let enc = wikiTitle.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? wikiTitle
                guard let url = URL(string: "https://en.wikipedia.org/api/rest_v1/page/summary/\(enc)") else { return }
                var req = URLRequest(url: url); req.setValue("WingDex-iOS/1.0", forHTTPHeaderField: "User-Agent")
                let (data, _) = try await URLSession.shared.data(for: req)
                try Task.checkCancellation()
                struct S: Codable { let thumbnail: T?; struct T: Codable { let source: String? } }
                let s = try JSONDecoder().decode(S.self, from: data)
                guard !Task.isCancelled else { return }
                let thumbURL = s.thumbnail?.source.flatMap { URL(string: $0) }
                await MainActor.run {
                    wikiImageURL = thumbURL
                    isLoadingWikiImage = false
                }
            } catch is CancellationError { /* expected */ }
            catch {
                log.debug("Wiki fetch failed: \(error.localizedDescription)")
                await MainActor.run { isLoadingWikiImage = false }
            }
        }
        galleryURLs = []
        galleryTask = Task {
            do {
                let enc = wikiTitle.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? wikiTitle
                guard let url = URL(string: "https://en.wikipedia.org/api/rest_v1/page/media-list/\(enc)") else { return }
                var req = URLRequest(url: url); req.setValue("WingDex-iOS/1.0", forHTTPHeaderField: "User-Agent")
                let (data, _) = try await URLSession.shared.data(for: req)
                try Task.checkCancellation()
                struct MediaList: Codable {
                    let items: [MediaItem]?
                    struct MediaItem: Codable {
                        let title: String?
                        let type: String?
                        let leadImage: Bool?
                        let srcset: [Srcset]?
                        struct Srcset: Codable { let src: String? }
                    }
                }
                let list = try JSONDecoder().decode(MediaList.self, from: data)
                guard !Task.isCancelled else { return }
                let excludePattern = try! NSRegularExpression(
                    pattern: "\\.(svg|gif)$|Status_|range_map|distribution|map_of|map\\.png|wikimedia-logo|commons-logo|wikidata-logo|cscr-|question_book|edit-clear|crystal_clear|ambox|folder_hexagonal",
                    options: .caseInsensitive
                )
                var urls: [URL] = []
                for item in list.items ?? [] {
                    guard item.type == "image", item.leadImage != true,
                          let title = item.title,
                          excludePattern.firstMatch(in: title, range: NSRange(title.startIndex..., in: title)) == nil,
                          let src = item.srcset?.first?.src else { continue }
                    let full = src.hasPrefix("//") ? "https:\(src)" : src
                    if let u = URL(string: full) { urls.append(u) }
                    if urls.count >= 6 { break }
                }
                guard !Task.isCancelled else { return }
                await MainActor.run { galleryURLs = urls }
            } catch is CancellationError { /* expected */ }
            catch { log.debug("Gallery fetch failed: \(error.localizedDescription)") }
        }
    }
}

// MARK: - Previews

#if DEBUG
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
                    IdentifiedCandidate(species: "Bald Eagle (Haliaeetus leucocephalus)", confidence: 0.92, wikiTitle: "Bald_eagle", plumage: nil, rangeStatus: nil),
                    IdentifiedCandidate(species: "Golden Eagle (Aquila chrysaetos)", confidence: 0.06, wikiTitle: "Golden_eagle", plumage: nil, rangeStatus: nil),
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
                    IdentifiedCandidate(species: "Northern Cardinal (Cardinalis cardinalis)", confidence: 0.55, wikiTitle: "Northern_cardinal", plumage: nil, rangeStatus: nil),
                    IdentifiedCandidate(species: "Vermilion Flycatcher (Pyrocephalus rubinus)", confidence: 0.30, wikiTitle: "Vermilion_flycatcher", plumage: nil, rangeStatus: nil),
                    IdentifiedCandidate(species: "Summer Tanager (Piranga rubra)", confidence: 0.10, wikiTitle: "Summer_tanager", plumage: nil, rangeStatus: nil),
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
                IdentifiedCandidate(species: "Northern Cardinal (Cardinalis cardinalis)", confidence: 0.55, wikiTitle: "Northern_cardinal", plumage: nil, rangeStatus: nil),
                IdentifiedCandidate(species: "Vermilion Flycatcher (Pyrocephalus rubinus)", confidence: 0.30, wikiTitle: "Vermilion_flycatcher", plumage: nil, rangeStatus: nil),
                IdentifiedCandidate(species: "Summer Tanager (Piranga rubra)", confidence: 0.10, wikiTitle: "Summer_tanager", plumage: nil, rangeStatus: nil),
            ]
        }
}
#endif
