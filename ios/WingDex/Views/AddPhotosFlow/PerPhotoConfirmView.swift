import MapKit
import SwiftUI

/// Per-photo species confirmation view.
///
struct PerPhotoConfirmView: View {
    @Bindable var viewModel: AddPhotosViewModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var presentation = PhotoConfirmationPresentation()
    @State private var opacity = 1.0

    private var liveKey: PhotoConfirmationPresentation.Key {
        .init(requestID: viewModel.identificationRequestID,
              isIdentifying: viewModel.currentStep == .photoProcessing)
    }

    var body: some View {
        ZStack {
            if let snapshot = presentation.displayed {
                PhotoConfirmationPage(
                    viewModel: viewModel, snapshot: snapshot,
                    isActive: presentation.isCurrent
                )
                .id(snapshot.key)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .opacity(reduceMotion ? 1 : opacity)
        .background(Color.pageBg.ignoresSafeArea())
        .onChange(of: liveKey, initial: true) { updatePresentation() }
        .onChange(of: reduceMotion) { updatePresentation() }
        .task(id: presentation.phase) {
            switch presentation.phase {
            case .fadingOut:
                withAnimation(.easeOut(duration: 0.1)) { opacity = 0 }
                do {
                    try await Task.sleep(for: .milliseconds(100))
                } catch { return }
                guard !Task.isCancelled else { return }
                // Read the latest result at the swap boundary, not at fade-out start.
                presentation.swapSnapshot()
            case .fadingIn:
                await Task.yield()
                guard !Task.isCancelled else { return }
                withAnimation(.easeIn(duration: 0.18)) { opacity = 1 }
                do {
                    try await Task.sleep(for: .milliseconds(180))
                } catch { return }
                guard !Task.isCancelled else { return }
                presentation.finishTransition()
            case .idle:
                break
            }
        }
    }

    private func updatePresentation() {
        guard viewModel.currentStep == .photoProcessing || viewModel.currentStep == .perPhotoConfirm else { return }
        presentation.update(.init(
            key: liveKey, photo: viewModel.currentPhoto,
            candidates: viewModel.currentCandidates,
            location: viewModel.currentInferenceLocation,
            useGeoContext: viewModel.useGeoContext
        ), reduceMotion: reduceMotion)
        if presentation.phase == .idle { opacity = 1 }
    }
}

private struct PhotoConfirmationPage: View {
    @Bindable var viewModel: AddPhotosViewModel
    let snapshot: PhotoConfirmationPresentation.Snapshot
    let isActive: Bool

    @State private var selectedSpecies = ""
    @State private var selectedConfidence: Double = 0
    @State private var isLoadingWikiImage = false
    @State private var galleryItems: [GalleryItem] = []
    @State private var galleryTask: Task<Void, Never>?
    @State private var galleryIndex = 0
    @State private var decodedCroppedImage: UIImage?
    @State private var decodedThumbnail: UIImage?
    @State private var decodedPhotoID: String?
    @State private var decodeTask: Task<Void, Never>?
    /// Set when a confirmed species turns out to be a mega, which is what makes
    /// the mark ping. Nil the rest of the time, so nothing animates by default.
    @State private var confirmedRarity: UUID?
    /// True only while a mega's ping plays, so a second tap cannot confirm twice.
    @State private var isAcknowledging = false
    /// Carries the candidate the peek opens on.
    @State private var peek: PeekRequest?
    @State private var showSkipConfirm = false
    @State private var showOutingDetails = false

    private struct PeekRequest: Identifiable {
        let id: Int
        var gallery: [GalleryItem] = []
        var photoIndex: Int = 0
        var galleryIsComplete = true
    }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var photo: ProcessedPhoto? { snapshot.photo }
    private var candidates: [IdentifiedCandidate] { snapshot.candidates }
    private var liveKey: PhotoConfirmationPresentation.Key {
        .init(requestID: viewModel.identificationRequestID,
              isIdentifying: viewModel.currentStep == .photoProcessing)
    }
    private var canAct: Bool {
        isActive && snapshot.key == liveKey
    }
    private var photoIndex: Int { viewModel.currentPhotoIndex }
    private var selectedPlumage: String? { candidates.first { $0.species == selectedSpecies }?.plumage }

    /// The verdict for one candidate on THIS photo.
    ///
    /// Gated on the same `useGeoContext` switch the ranker uses: a user who has
    /// turned geographic context off has asked not to be told where a bird
    /// belongs, and a mark would answer a question they declined.
    private func rarity(for species: String) -> RarityState {
        guard snapshot.useGeoContext, let photo else { return .none }
        let location = snapshot.location
        // Same month derivation the ranker used for this photo, so the mark can
        // never contradict the ranking that produced the candidate.
        return RarityStore.shared.state(
            species: species,
            lat: location?.lat,
            lon: location?.lon,
            month: photo.exifTime.map { Calendar.current.component(.month, from: $0) }
        )
    }

    private var isIdentifying: Bool { snapshot.key.isIdentifying }
    private var hasCandidates: Bool { !isIdentifying && !candidates.isEmpty }

    private var peekCandidates: [SpeciesPeekCandidate] {
        candidates.map {
            SpeciesPeekCandidate(species: $0.species, confidence: $0.confidence,
                                 plumage: $0.plumage, rarity: rarity(for: $0.species))
        }
    }

    private func openPeek(at position: Int) {
        peek = PeekRequest(id: position)
    }

    private func openPeekAtSelection() {
        peek = PeekRequest(
            id: candidates.firstIndex { $0.species == selectedSpecies } ?? 0,
            gallery: galleryItems, photoIndex: galleryIndex,
            // The lead image may be the fallback from a transient Commons failure.
            // Let the sheet retry; successful searches are satisfied from its cache.
            galleryIsComplete: false
        )
    }

// MARK: - Body

    var body: some View {
        VStack(spacing: 0) {
            if isIdentifying {
                identifyingView
            } else if hasCandidates {
                candidateView
            } else {
                noCandidatesView
            }
        }
        .allowsHitTesting(canAct)
        .accessibilityHidden(!canAct)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.pageBg.ignoresSafeArea())
        .navigationTitle("Photo \(photoIndex + 1) of \(viewModel.clusterPhotos.count)")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                PhotoSequenceToolbar(photos: viewModel.clusterPhotos, selectedPhotoID: photo?.id)
                    .disabled(!canAct || isAcknowledging)
            }

            ToolbarItem(placement: .confirmationAction) {
                Group {
                    if !canAct || !hasCandidates || selectedSpecies.isEmpty || isAcknowledging {
                        Button {} label: {
                            Image(systemName: "checkmark")
                        }
                        .accessibilityLabel("Confirm")
                        .accessibilityIdentifier("confirm.accept")
                    } else if isHighConfidence {
                        Button {
                            confirmWith(status: .confirmed)
                        } label: {
                            Image(systemName: "checkmark")
                        }
                        .buttonStyle(.borderedProminent)
                        .accessibilityLabel("Confirm")
                        .accessibilityIdentifier("confirm.accept")
                        .contextMenu {
                            confirmationActions
                        } preview: {
                            EmptyView()
                        }
                    } else {
                        Menu {
                            confirmationActions
                        } label: {
                            Image(systemName: "checkmark")
                        }
                        .badge("?")
                        .menuIndicator(.hidden)
                        .tint(.primary)
                        .accessibilityLabel("Choose identification status")
                        .accessibilityIdentifier("confirm.accept")
                    }
                }
                .buttonBorderShape(.circle)
                .disabled(!canAct || !hasCandidates || selectedSpecies.isEmpty || isAcknowledging)
            }

            ToolbarItem(placement: .topBarLeading) {
                Button {
                    if photoIndex > 0 {
                        viewModel.goBackToPreviousPhoto()
                    } else {
                        viewModel.returnToOutingReview()
                    }
                } label: {
                    Image(systemName: "chevron.left")
                }
                .accessibilityLabel(photoIndex > 0 ? "Previous Photo" : "Review Outing")
                .accessibilityIdentifier("confirm.back")
                .disabled(isAcknowledging)
            }

            ToolbarItem(placement: .bottomBar) {
                Button("Crop", systemImage: "crop") {
                    viewModel.requestManualCrop()
                }
                .accessibilityIdentifier("confirm.crop")
                .disabled(!canAct || isIdentifying || isAcknowledging)
            }
            ToolbarSpacer(.flexible, placement: .bottomBar)
            ToolbarItem(placement: .bottomBar) {
                Button {
                    showOutingDetails = true
                } label: {
                    VStack(spacing: 1) {
                        Text(viewModel.lastLocationName.isEmpty ? "Outing Details" : viewModel.lastLocationName)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                        if let outingSubtitle {
                            Text(outingSubtitle)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    .frame(maxWidth: 190)
                    .padding(.horizontal, 8)
                }
                .accessibilityLabel(outingDetailsLabel)
                .accessibilityHint("Opens outing details and map")
                .accessibilityIdentifier("confirm.outingDetails")
                .disabled(isAcknowledging)
            }
            ToolbarSpacer(.flexible, placement: .bottomBar)
            ToolbarItem(placement: .bottomBar) {
                Button("Skip", systemImage: "delete.forward") {
                    showSkipConfirm = true
                }
                .accessibilityIdentifier("confirm.skip")
                .disabled(!canAct || isIdentifying || isAcknowledging)
            }
        }
        .alert("Skip Photo?", isPresented: $showSkipConfirm) {
            Button("Skip Photo", role: .destructive) {
                viewModel.skipCurrentPhoto()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This photo will be excluded from the outing and will not be saved.")
        }
        .onAppear { initializeSelection() }
        .sheet(isPresented: $showOutingDetails) {
            outingDetailsSheet
        }
        .sheet(item: $peek) { request in
            SpeciesPeekSheet(
                candidates: peekCandidates,
                startIndex: request.id,
                userPhoto: decodedCroppedImage ?? decodedThumbnail,
                initialGallery: request.gallery,
                initialPhotoIndex: request.photoIndex,
                initialGalleryIsComplete: request.galleryIsComplete,
                onConfirm: { candidate in
                    guard let match = candidates.first(where: { $0.species == candidate.species })
                    else { return }
                    selectAlternative(match)
                    confirmWith(status: .confirmed, species: match.species, confidence: match.confidence)
                }
            )
        }
        .onDisappear {
            decodeTask?.cancel()
            galleryTask?.cancel()
        }
    }

    @ViewBuilder
    private var confirmationActions: some View {
        Button("Mark as Confirmed", systemImage: "checkmark.circle.fill") {
            confirmWith(status: .confirmed)
        }
        Button("Mark as Possible", systemImage: "questionmark.circle.dashed") {
            confirmWith(status: .possible)
        }
        Divider()
        Button("Skip", systemImage: "delete.forward") {
            showSkipConfirm = true
        }
    }

    private var identifyingView: some View {
        VStack(spacing: 24) {
            Spacer()
            if let image = decodedThumbnail {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxHeight: 280)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            ProgressView()
            Text("Identifying...")
                .font(.headline)
                .accessibilityIdentifier("confirm.identifying")
            Spacer()
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Outing Details

    private var outingTitle: String {
        "Outing \(viewModel.currentClusterIndex + 1) of \(viewModel.clusters.count)"
    }

    private var outingSubtitle: String? {
        viewModel.currentOutingStartTime.map {
            "\(DateFormatting.formatDate($0)) · \(DateFormatting.formatTime($0))"
        }
    }

    private var outingDetailsSheet: some View {
        NavigationStack {
            Group {
                if let coordinate = viewModel.outingInferenceLocation,
                   let location = OutingMapLocation(
                    name: viewModel.lastLocationName,
                    coordinate: CLLocationCoordinate2D(latitude: coordinate.lat, longitude: coordinate.lon),
                    sourceDescription: "Outing location"
                   ) {
                    OutingLocationMapView(
                        location: location, title: outingTitle, subtitle: outingSubtitle
                    )
                } else {
                    ContentUnavailableView(
                        viewModel.lastLocationName.isEmpty ? "Unknown Location" : viewModel.lastLocationName,
                        systemImage: "mappin.slash",
                        description: Text("No location coordinates")
                    )
                    .navigationTitle(outingTitle)
                    .navigationSubtitle(outingSubtitle ?? "")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Close", systemImage: "xmark") { showOutingDetails = false }
                                .labelStyle(.iconOnly)
                                .accessibilityIdentifier("outing.mapClose")
                        }
                    }
                }
            }
            .background(Color.pageBg.ignoresSafeArea())
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    // MARK: - No Candidates

    private var noCandidatesView: some View {
        GeometryReader { geo in
            ScrollView {
                VStack(spacing: 24) {
                    Spacer(minLength: 0)

                    if let uiImage = decodedThumbnail {
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
                        .accessibilityIdentifier("confirm.noCandidates")

                    VStack(spacing: 12) {
                        Button {
                            viewModel.requestManualCrop()
                        } label: {
                            Label("Crop and Retry", systemImage: "crop")
                                .font(.body.weight(.medium))
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.glassProminent)
                        .buttonSizing(.flexible)
                        .accessibilityIdentifier("confirm.cropAndRetry")

                        Button {
                            showSkipConfirm = true
                        } label: {
                            Label("Skip", systemImage: "delete.forward")
                                .font(.body.weight(.medium))
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.glass)
                        .buttonSizing(.flexible)
                        .accessibilityIdentifier("confirm.noCandidatesSkip")
                    }
                    .frame(maxWidth: 340)
                    .padding(.horizontal, 32)
                    .disabled(!canAct || isAcknowledging)

                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, minHeight: geo.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
    }

    // MARK: - Candidate View

    private var candidateView: some View {
        GeometryReader { geo in
            let contentWidth = min(geo.size.width - 32, 400)
            let photoSize = max((contentWidth - 12) / 2, 0)

            ScrollView {
                VStack(spacing: 0) {
                    VStack(spacing: 16) {
                        HStack(alignment: .top, spacing: 12) {
                            VStack(spacing: 6) {
                                Button {
                                    viewModel.requestManualCrop()
                                } label: {
                                    aiCroppedUserPhoto(size: photoSize)
                                        .overlay(alignment: .bottomTrailing) {
                                            photoActionIndicator("crop")
                                        }
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Crop your photo")
                                .accessibilityIdentifier("confirm.userPhoto")
                                .disabled(photo == nil || isAcknowledging)
                                Text("Yours")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2, reservesSpace: true)
                            }
                            .frame(width: photoSize)

                            VStack(spacing: 6) {
                            wikiSquareThumbnail(size: photoSize)
                                .overlay(alignment: .bottomTrailing) {
                                    photoActionIndicator("info")
                                }
                                .contentShape(Rectangle())
                                .onTapGesture {
                                    guard !isAcknowledging else { return }
                                    openPeekAtSelection()
                                }
                                .accessibilityElement(children: .ignore)
                                .accessibilityAddTraits(.isButton)
                                .accessibilityLabel("Explore \(getDisplayName(selectedSpecies))")
                                .accessibilityHint("Opens reference photos and species details")
                                .accessibilityAction {
                                    guard !isAcknowledging else { return }
                                    openPeekAtSelection()
                                }
                                .frame(width: photoSize)
                                Group {
                                    let credit = currentRefCredit
                                    if let url = credit.url {
                                        Link(credit.label, destination: url).underline()
                                    } else {
                                        Text(credit.label)
                                    }
                                }
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                                .lineLimit(2, reservesSpace: true)
                            }
                            .frame(width: photoSize)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.horizontal, 16)

                        speciesCard
                        Text("Photos from [Wikimedia Commons](https://commons.wikimedia.org), occurrence data from [iNaturalist](https://www.inaturalist.org).")
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                            .tint(.secondary)
                            .frame(maxWidth: .infinity)
                            .accessibilityIdentifier("confirm.attribution")
                    }
                    .padding(.top, 24)

                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, minHeight: geo.size.height)
            }
            .task(id: photoSize) {
                guard photoSize > 0 else { return }
                let leads = candidates.compactMap { candidate in
                    let thumbnail = getWikiThumbnailUrl(for: candidate.species)
                    return CommonsGallery.leadImage(cardImageUrl(fromThumbnail: thumbnail) ?? thumbnail)?.url
                }
                await withTaskGroup(of: Void.self) { group in
                    for url in leads {
                        group.addTask {
                            await Self.preloadReference(url: url, size: photoSize)
                        }
                    }
                }
            }
        }
    }

    // MARK: - AI-Cropped Square User Photo

    @MainActor
    private static func preloadReference(url: URL, size: CGFloat) async {
        guard !Task.isCancelled else { return }
        _ = await ImageLoader.shared.imageAndFocalPoint(for: url.absoluteString, targetPoints: size)
    }

    private func photoActionIndicator(_ symbol: String) -> some View {
        Image(systemName: symbol)
            .font(.caption.weight(.semibold))
            .frame(width: 28, height: 28)
            .glassEffect(.regular, in: Circle())
            .padding(8)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    private func aiCroppedUserPhoto(size: CGFloat) -> some View {
        Group {
            if let img = decodedCroppedImage {
                Image(uiImage: img)
                    .resizable()
                    .scaledToFill()
                    .frame(width: size, height: size)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            } else {
                fallbackPhoto(size: size)
            }
        }
    }

    private func fallbackPhoto(size: CGFloat) -> some View {
        Group {
            if let uiImage = decodedThumbnail {
                FocalImage(
                    image: uiImage,
                    focalPoint: photo?.suggestedFocalPoint ?? FocalCropGeometry.center
                )
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

    // MARK: - Wiki Square Thumbnail (swipeable gallery)

    private var allWikiURLs: [URL] { galleryItems.map(\.url) }

    /// Caption for the current gallery image. Attribution rides on the link to the Commons
    /// file page, which CC 4.0 3(a)(2) accepts in place of an inline creator/license line.
    private var currentRefCredit: (label: String, url: URL?) {
        let items = galleryItems
        guard !items.isEmpty else { return ("Reference", nil) }
        let item = items[min(max(galleryIndex, 0), items.count - 1)]
        let label = item.plumage.map { "Reference (\($0))" } ?? "Reference"
        return (label, item.descriptionUrl)
    }

    private func wikiSquareThumbnail(size: CGFloat) -> some View {
        let urls = allWikiURLs
        let safeIndex = urls.isEmpty ? 0 : min(galleryIndex, urls.count - 1)

        return ZStack(alignment: .bottom) {
            if urls.isEmpty {
                if isLoadingWikiImage && !isIdentifying {
                    wikiPlaceholder(size: size)
                        .overlay { ProgressView() }
                } else {
                    wikiPlaceholder(size: size)
                }
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    // At most four photos: mount them eagerly to load ahead of swipes.
                    HStack(spacing: 0) {
                        ForEach(Array(urls.enumerated()), id: \.element) { i, url in
                            BirdThumbnail(url: url.absoluteString, size: size, cornerRadius: 12)
                                .frame(width: size, height: size)
                                .id(i)
                        }
                    }
                    .scrollTargetLayout()
                }
                .scrollTargetBehavior(.paging)
                .scrollPosition(id: Binding(
                    get: { safeIndex },
                    set: { if let v = $0 { galleryIndex = v } }
                ))
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
        .contextMenu {
            Button {
                openPeekAtSelection()
            } label: {
                Label("Learn More", systemImage: "book")
            }
        }
    }

    private func wikiPlaceholder(size: CGFloat) -> some View {
        BirdImagePlaceholder()
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Species Card

    private var speciesCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .center, spacing: 8) {
                ZStack(alignment: .leading) {
                    Text(getDisplayName(selectedSpecies))
                        .font(.system(.title3, design: .serif, weight: .semibold))
                        .lineLimit(2, reservesSpace: true)
                        .hidden()
                    HStack(alignment: .center, spacing: 6) {
                        Text(getDisplayName(selectedSpecies))
                            .font(.system(.title3, design: .serif, weight: .semibold))
                            .multilineTextAlignment(.leading)
                            .lineLimit(2)
                        let state = rarity(for: selectedSpecies)
                        if state != .none {
                            RarityMark(state: state, pingTrigger: confirmedRarity)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityRepresentation {
                    Text(getDisplayName(selectedSpecies))
                        .accessibilityIdentifier("confirm.speciesName")
                    }
                Text(BirdIdEngine.formatConfidence(selectedConfidence))
                    .font(.system(.title, design: .serif).weight(.semibold).monospacedDigit())
                    .foregroundStyle(Color.confidence(selectedConfidence))
                    .accessibilityIdentifier("confirm.confidence")
            }
            .padding(.bottom, 8)
            ProgressView(value: selectedConfidence)
                .tint(Color.confidence(selectedConfidence))
                .transaction {
                    $0.animation = nil
                    $0.disablesAnimations = true
                }
                .padding(.bottom, 12)
            ForEach(Array(candidates.enumerated()), id: \.element.species) { position, candidate in
                candidateRow(candidate, at: position)
            }
        }
        .padding(16)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
        .padding(.horizontal, 16)
    }

    private func candidateRow(_ candidate: IdentifiedCandidate, at position: Int) -> some View {
        let isSelected = candidate.species == selectedSpecies
        return HStack(spacing: 8) {
            Button {
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.12)) {
                    selectAlternative(candidate)
                }
            } label: {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                        .font(.body)
                        .foregroundStyle(isSelected ? Color.accentColor : Color.secondary.opacity(0.4))
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Text(getDisplayName(candidate.species))
                                .font(.body)
                                .foregroundStyle(Color.foregroundText)
                                .multilineTextAlignment(.leading)
                                .fixedSize(horizontal: false, vertical: true)
                            let state = rarity(for: candidate.species)
                            if state != .none {
                                RarityMark(state: state, pingTrigger: isSelected ? confirmedRarity : nil)
                            }
                        }
                        if let plumage = candidate.plumage {
                            Text(plumage)
                                .font(.caption)
                                .foregroundStyle(Color.mutedText)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(isAcknowledging)
            .accessibilityHint("Selects this identification")
            .accessibilityAction(named: "Learn more") { openPeek(at: position) }

            Button {
                if isSelected { openPeekAtSelection() }
                else { openPeek(at: position) }
            } label: {
                Text(BirdIdEngine.formatConfidence(candidate.confidence))
                    .font(.body.monospacedDigit())
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .accessibilityLabel("\(BirdIdEngine.formatConfidence(candidate.confidence)), learn more about \(getDisplayName(candidate.species))")
            .disabled(isAcknowledging)
        }
        .padding(.vertical, 4)
    }

    // MARK: - Helpers

    private var isHighConfidence: Bool {
        selectedConfidence >= BirdIdEngine.confidencePromptThreshold
    }
    private var outingDetailsLabel: String {
        let location = viewModel.lastLocationName.isEmpty ? "Unknown Location" : viewModel.lastLocationName
        guard let startTime = viewModel.currentOutingStartTime else { return location }
        return "\(location), \(DateFormatting.formatDate(startTime)), \(DateFormatting.formatTime(startTime))"
    }

    private func initializeSelection() {
        if let top = candidates.first {
            selectedSpecies = top.species
            selectedConfidence = top.confidence
        } else { selectedSpecies = ""; selectedConfidence = 0 }
        decodeUserImages()
        fetchWikiImage()
    }

    private func selectAlternative(_ candidate: IdentifiedCandidate) {
        guard !isAcknowledging else { return }
        selectedSpecies = candidate.species
        selectedConfidence = candidate.confidence
        fetchWikiImage()
    }

    /// Decode user photo images off the main thread so the view body never calls UIImage(data:).
    /// Captures only Sendable values into the detached task.
    private func decodeUserImages() {
        decodeTask?.cancel()
        guard let currentPhoto = photo else { return }
        // Do not blank an already decoded photo when only its candidates change.
        if decodedPhotoID != currentPhoto.id {
            decodedCroppedImage = nil
            decodedThumbnail = nil
        }
        let photoId = currentPhoto.id
        let croppedData = currentPhoto.croppedImage
        let thumbData = currentPhoto.thumbnail
        decodeTask = Task.detached(priority: .userInitiated) {
            let decoded = Self.decodeImages(
                croppedData: croppedData,
                thumbData: thumbData
            )
            guard !Task.isCancelled else { return }
            await MainActor.run {
                guard !Task.isCancelled, photo?.id == photoId else { return }
                decodedCroppedImage = decoded.cropped
                decodedThumbnail = decoded.thumb
                decodedPhotoID = photoId
            }
        }
    }

    /// Sendable wrapper for the decoded UIImages crossing the actor boundary.
    private struct DecodedImages: @unchecked Sendable {
        let cropped: UIImage?
        let thumb: UIImage?
    }

    private nonisolated static func decodeImages(
        croppedData: Data?,
        thumbData: Data
    ) -> DecodedImages {
        let cropped = croppedData.flatMap { UIImage(data: $0) }
        let thumb = UIImage(data: thumbData)
        return DecodedImages(cropped: cropped, thumb: thumb)
    }

    /// `species` and `confidence` default to the on-screen selection. The peek sheet
    /// passes them explicitly because it confirms in the same run loop as it selects,
    /// before the state it just set has been published.
    private func confirmWith(status: ObservationStatus, species: String? = nil, confidence: Double? = nil) {
        guard canAct, !isIdentifying, !isAcknowledging else { return }
        let species = species ?? selectedSpecies
        let confidence = confidence ?? selectedConfidence
        // The mega gets its own beat before the wizard moves on: a ping on the
        // mark and a soft two-tap, deliberately NOT the lifer confetti and NOT
        // the lifer success haptic. If the bird is also a lifer, that
        // celebration fires on save and this stays the smaller, earlier moment.
        //
        // Advancing immediately would unmount the mark mid-animation, so the
        // wizard waits. Pausing to acknowledge IS the moment, and at 1 in 208
        // confirmations it is not a tax on the common path.
        let commit = {
            viewModel.confirmCurrentPhoto(species: species,
                                          confidence: confidence,
                                          status: status,
                                          count: 1)
        }
        guard rarity(for: species) == .both else { return commit() }

        UIImpactFeedbackGenerator(style: .rigid).impactOccurred(intensity: 1.0)
        guard !reduceMotion else { return commit() }
        // Two beats, not one. A single tap is indistinguishable from the tap the
        // user just made on the confirm button.
        Task {
            try? await Task.sleep(for: .milliseconds(130))
            UIImpactFeedbackGenerator(style: .rigid).impactOccurred(intensity: 1.0)
        }
        confirmedRarity = UUID()
        isAcknowledging = true
        // Back, Skip, Re-identify, Re-crop and Close all stay reachable during
        // the hold, and every one of them moves the wizard. Committing blind
        // afterwards would file this species against whatever photo is showing
        // by then, so the commit is bound to the photo it was made for. The
        // toolbar is disabled too, which is the cheaper half of the fix.
        let confirmedPhotoID = photo?.id
        Task {
            try? await Task.sleep(for: .milliseconds(900))
            isAcknowledging = false
            guard let confirmedPhotoID, viewModel.currentPhoto?.id == confirmedPhotoID else { return }
            commit()
        }
    }

    private func fetchWikiImage() {
        galleryTask?.cancel()
        galleryIndex = 0
        let species = selectedSpecies
        guard !species.isEmpty else { galleryItems = []; galleryIndex = 0; return }

        let displayName = getDisplayName(species)
        // Commons relevance ordering routinely opens on a nest or a female, so the taxonomy
        // lead image goes first: it is the shot the species page already shows.
        let leadThumb = getWikiThumbnailUrl(for: species)
        let leadImageUrl = cardImageUrl(fromThumbnail: leadThumb) ?? leadThumb
        let plumage = selectedPlumage
        isLoadingWikiImage = true
        galleryItems = CommonsGallery.leadImage(leadImageUrl).map { [$0] } ?? []

        galleryTask = Task {
            let items = await CommonsGallery.fetch(
                displayName: displayName,
                leadImageUrl: leadImageUrl,
                plumage: plumage
            )
            guard !Task.isCancelled else { return }
            galleryItems = Array(items.prefix(4))
            isLoadingWikiImage = false
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
                vm.lastLocationName = "Carkeek Park"
                vm.clusters = [PreviewData.sampleCluster(photoCount: 3)]
                vm.currentPhotoIndex = 1
                vm.photoResults = [PhotoResult(
                    photoId: "preview-0", species: "Bald Eagle (Haliaeetus leucocephalus)",
                    confidence: 0.95, status: .confirmed, count: 1
                )]
                vm.currentCandidates = [
                    IdentifiedCandidate(species: "Bald Eagle (Haliaeetus leucocephalus)", confidence: 0.92, wikiTitle: "Bald_eagle", plumage: nil),
                    IdentifiedCandidate(species: "Golden Eagle (Aquila chrysaetos)", confidence: 0.06, wikiTitle: "Golden_eagle", plumage: nil),
                ]
            }
    }
}

#Preview("Low Confidence") {
    NavigationStack {
        let vm = AddPhotosViewModel()
        PerPhotoConfirmView(viewModel: vm)
            .onAppear {
                vm.lastLocationName = "Discovery Park"
                vm.clusters = [PreviewData.sampleCluster(photoCount: 5)]
                vm.currentPhotoIndex = 2
                vm.currentCandidates = [
                    IdentifiedCandidate(species: "Northern Cardinal (Cardinalis cardinalis)", confidence: 0.55, wikiTitle: "Northern_cardinal", plumage: nil),
                    IdentifiedCandidate(species: "Vermilion Flycatcher (Pyrocephalus rubinus)", confidence: 0.30, wikiTitle: "Vermilion_flycatcher", plumage: nil),
                    IdentifiedCandidate(species: "Summer Tanager (Piranga rubra)", confidence: 0.10, wikiTitle: "Summer_tanager", plumage: nil),
                ]
            }
    }
}

#Preview("No Candidates") {
    NavigationStack {
        let vm = AddPhotosViewModel()
        PerPhotoConfirmView(viewModel: vm)
            .onAppear {
                vm.lastLocationName = "Olympic Sculpture Park"
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
            vm.lastLocationName = "Discovery Park"
            vm.clusters = [PreviewData.sampleCluster(photoCount: 5)]
            vm.currentPhotoIndex = 2
            vm.currentCandidates = [
                IdentifiedCandidate(species: "Northern Cardinal (Cardinalis cardinalis)", confidence: 0.55, wikiTitle: "Northern_cardinal", plumage: nil),
                IdentifiedCandidate(species: "Vermilion Flycatcher (Pyrocephalus rubinus)", confidence: 0.30, wikiTitle: "Vermilion_flycatcher", plumage: nil),
                IdentifiedCandidate(species: "Summer Tanager (Piranga rubra)", confidence: 0.10, wikiTitle: "Summer_tanager", plumage: nil),
            ]
        }
}
#endif
