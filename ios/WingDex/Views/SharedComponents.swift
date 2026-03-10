import SwiftUI
import MapKit
import UIKit

// MARK: - Image Cache

/// In-memory image cache shared across all thumbnails to avoid re-downloads on scroll.
@MainActor
private final class ImageCache {
    static let shared = ImageCache()
    private var cache = NSCache<NSString, UIImage>()
    init() { cache.countLimit = 200 }

    func image(for key: String) -> UIImage? { cache.object(forKey: key as NSString) }
    func set(_ image: UIImage, for key: String) { cache.setObject(image, forKey: key as NSString) }
}

// MARK: - Bird Thumbnail

/// Portrait-aware bird thumbnail that crops tall images near the top (head area).
/// Uses an in-memory cache for smooth scrolling.
struct BirdThumbnail: View {
    let url: String?
    var size: CGFloat = 48
    var cornerRadius: CGFloat = 8
    @State private var uiImage: UIImage?

    var body: some View {
        Group {
            if let uiImage {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFill()
                    .frame(width: size, height: size, alignment: .top)
            } else {
                placeholder
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
        .task(id: url) { await loadImage() }
    }

    private func loadImage() async {
        guard let url, let imageURL = URL(string: url) else { return }
        if let cached = ImageCache.shared.image(for: url) {
            uiImage = cached
            return
        }
        do {
            let (data, _) = try await URLSession.shared.data(from: imageURL)
            guard let loaded = UIImage(data: data) else { return }
            ImageCache.shared.set(loaded, for: url)
            uiImage = loaded
        } catch {
            // Leave placeholder
        }
    }

    private var placeholder: some View {
        Rectangle()
            .fill(Color.warmBorder.opacity(0.2))
            .overlay {
                Image(systemName: "bird.fill")
                    .foregroundStyle(Color.mutedText.opacity(0.3))
            }
    }
}

// MARK: - Bird Row

/// Reusable bird species row used in WingDex list, outing detail species, and home.
/// Matches web app's BirdRow/ListRow pattern: thumbnail, serif name, italic scientific name, metadata.
struct BirdRow: View {
    let speciesName: String
    var thumbnailUrl: String?
    var subtitle: String?
    var count: Int?

    var body: some View {
        HStack(spacing: 12) {
            BirdThumbnail(url: thumbnailUrl, size: 48)

            VStack(alignment: .leading, spacing: 2) {
                Text(getDisplayName(speciesName))
                    .font(.system(size: 16, weight: .semibold, design: .serif))
                    .foregroundStyle(Color.foregroundText)
                    .lineLimit(1)

                if let sci = getScientificName(speciesName) {
                    Text(sci)
                        .font(.system(size: 13))
                        .italic()
                        .foregroundStyle(Color.mutedText)
                        .lineLimit(1)
                }

                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(Color.mutedText)
                        .lineLimit(1)
                }

                if let count, count > 1 {
                    Text("x\(count)")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.mutedText)
                }
            }

            Spacer()
        }
        .contentShape(Rectangle())
        .padding(.vertical, 2)
    }
}

// MARK: - Species Card

/// Square gradient-overlay species card for horizontal scroll (Home recent species).
/// Image fills the card with species name overlaid at the bottom with gradient.
struct SpeciesCard: View {
    let entry: DexEntry
    var size: CGFloat = 120

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            BirdThumbnail(url: entry.thumbnailUrl, size: size, cornerRadius: 0)
                .frame(width: size, height: size)

            // Gradient overlay
            LinearGradient(
                colors: [.clear, .black.opacity(0.6)],
                startPoint: .center,
                endPoint: .bottom
            )

            Text(getDisplayName(entry.speciesName))
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white.opacity(0.9))
                .lineLimit(2)
                .padding(.horizontal, 10)
                .padding(.bottom, 8)
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .contentShape(.contextMenuPreview, RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

// MARK: - Context Menu

/// UIKit-backed context menu host that supports preview commit (tap preview to navigate).
///
/// WHY UIKit instead of SwiftUI .contextMenu:
/// 1. SwiftUI .contextMenu on a ForEach inside a ScrollView targets the entire scroll
///    container, not individual items. Each species card in the Home carousel needs its
///    own independent long-press hit target.
/// 2. SwiftUI .contextMenu has no preview commit callback - when the user taps the
///    peeked preview, there is no way to trigger navigation. UIContextMenuInteraction's
///    willPerformPreviewAction delegate method provides this.
/// 3. SwiftUI .contextMenu does not support UIMenu, limiting action organization.
struct PeekPopContextMenu<Content: View, Preview: View>: UIViewControllerRepresentable {
    let content: Content
    let preview: Preview
    let menu: UIMenu
    let previewSize: CGSize?
    let onTap: () -> Void
    let onCommit: () -> Void

    init(
        menu: UIMenu,
        previewSize: CGSize? = nil,
        onTap: @escaping () -> Void,
        onCommit: (() -> Void)? = nil,
        @ViewBuilder content: () -> Content,
        @ViewBuilder preview: () -> Preview
    ) {
        self.content = content()
        self.preview = preview()
        self.menu = menu
        self.previewSize = previewSize
        self.onTap = onTap
        self.onCommit = onCommit ?? onTap
    }

    func makeUIViewController(context: Context) -> ContainerViewController {
        let controller = ContainerViewController()
        controller.update(
            content: AnyView(content),
            preview: AnyView(preview),
            menu: menu,
            previewSize: previewSize,
            onTap: onTap,
            onCommit: onCommit
        )
        return controller
    }

    func updateUIViewController(_ uiViewController: ContainerViewController, context: Context) {
        uiViewController.update(
            content: AnyView(content),
            preview: AnyView(preview),
            menu: menu,
            previewSize: previewSize,
            onTap: onTap,
            onCommit: onCommit
        )
    }

    @MainActor
    final class ContainerViewController: UIViewController, UIContextMenuInteractionDelegate {
        private let hostingController = UIHostingController(rootView: AnyView(EmptyView()))
        private lazy var tapGesture = UITapGestureRecognizer(target: self, action: #selector(handleTap))
        private lazy var contextMenuInteraction = UIContextMenuInteraction(delegate: self)

        private var previewView = AnyView(EmptyView())
        private var contextMenu = UIMenu(children: [])
        private var preferredPreviewSize: CGSize?
        private var onTapAction: (() -> Void)?
        private var onCommitAction: (() -> Void)?
        private var didSetup = false

        override func viewDidLoad() {
            super.viewDidLoad()
            setupIfNeeded()
        }

        func update(
            content: AnyView,
            preview: AnyView,
            menu: UIMenu,
            previewSize: CGSize?,
            onTap: @escaping () -> Void,
            onCommit: @escaping () -> Void
        ) {
            setupIfNeeded()
            hostingController.rootView = content
            previewView = preview
            contextMenu = menu
            preferredPreviewSize = previewSize
            onTapAction = onTap
            onCommitAction = onCommit
        }

        private func setupIfNeeded() {
            guard !didSetup else { return }
            didSetup = true

            view.backgroundColor = .clear
            hostingController.view.backgroundColor = .clear

            addChild(hostingController)
            hostingController.view.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(hostingController.view)
            NSLayoutConstraint.activate([
                hostingController.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                hostingController.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                hostingController.view.topAnchor.constraint(equalTo: view.topAnchor),
                hostingController.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            ])
            hostingController.didMove(toParent: self)

            tapGesture.cancelsTouchesInView = false
            view.addGestureRecognizer(tapGesture)
            view.addInteraction(contextMenuInteraction)
        }

        @objc
        private func handleTap() {
            onTapAction?()
        }

        func contextMenuInteraction(
            _ interaction: UIContextMenuInteraction,
            configurationForMenuAtLocation location: CGPoint
        ) -> UIContextMenuConfiguration? {
            UIContextMenuConfiguration(
                identifier: nil,
                previewProvider: { [previewView, preferredPreviewSize] in
                    let controller = UIHostingController(rootView: previewView)
                    controller.view.backgroundColor = .clear
                    controller.sizingOptions = [.preferredContentSize]
                    if let preferredPreviewSize {
                        controller.preferredContentSize = preferredPreviewSize
                    }
                    return controller
                },
                actionProvider: { [contextMenu] _ in contextMenu }
            )
        }

        func contextMenuInteraction(
            _ interaction: UIContextMenuInteraction,
            previewForHighlightingMenuWithConfiguration configuration: UIContextMenuConfiguration
        ) -> UITargetedPreview? {
            let parameters = UIPreviewParameters()
            parameters.backgroundColor = .clear
            parameters.visiblePath = UIBezierPath(roundedRect: view.bounds, cornerRadius: 12)
            return UITargetedPreview(view: view, parameters: parameters)
        }

        func contextMenuInteraction(
            _ interaction: UIContextMenuInteraction,
            previewForDismissingMenuWithConfiguration configuration: UIContextMenuConfiguration
        ) -> UITargetedPreview? {
            let parameters = UIPreviewParameters()
            parameters.backgroundColor = .clear
            parameters.visiblePath = UIBezierPath(roundedRect: view.bounds, cornerRadius: 12)
            return UITargetedPreview(view: view, parameters: parameters)
        }

        func contextMenuInteraction(
            _ interaction: UIContextMenuInteraction,
            willPerformPreviewActionForMenuWith configuration: UIContextMenuConfiguration,
            animator: any UIContextMenuInteractionCommitAnimating
        ) {
            animator.preferredCommitStyle = .pop
            animator.addCompletion { [weak self] in
                self?.onCommitAction?()
            }
        }
    }
}

// MARK: - Maps Helper

/// Open an outing's location in Apple Maps.
func openInMaps(outing: Outing, lat: Double, lon: Double) {
    let location = CLLocation(latitude: lat, longitude: lon)
    let mapItem = MKMapItem(location: location, address: nil)
    mapItem.name = outing.locationName.isEmpty ? "Outing" : outing.locationName
    mapItem.openInMaps()
}

// MARK: - Outing Row

/// Reusable outing row with mini map (when coordinates available) or subtle pin icon.
/// Used in HomeView, OutingsView, and SpeciesDetailView sightings.
struct OutingRow: View {
    let outing: Outing
    let store: DataStore

    var body: some View {
        let confirmed = store.confirmedObservations(outing.id)
        let speciesNames = Array(Set(confirmed.map(\.speciesName))).sorted()

        HStack(alignment: .center, spacing: 12) {
            outingLeadingIcon

            VStack(alignment: .leading, spacing: 2) {
                Text(outing.locationName.isEmpty ? "Outing" : outing.locationName)
                    .font(.system(size: 16, weight: .semibold, design: .serif))
                    .foregroundStyle(Color.foregroundText)
                    .lineLimit(1)

                Text("\(DateFormatting.formatDate(outing.startTime, style: .medium)) \u{00B7} \(speciesNames.count) species")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.mutedText)

                if !speciesNames.isEmpty {
                    Text(
                        speciesNames.prefix(2).map { getDisplayName($0) }.joined(separator: ", ")
                        + (speciesNames.count > 2 ? " +\(speciesNames.count - 2) more" : "")
                    )
                    .font(.system(size: 13))
                    .foregroundStyle(Color.mutedText)
                    .lineLimit(1)
                }
            }
        }
        .contentShape(Rectangle())
        .padding(.vertical, 2)
    }

    @ViewBuilder
    private var outingLeadingIcon: some View {
        if let lat = outing.lat, let lon = outing.lon {
            MiniMapSnapshot(latitude: lat, longitude: lon, size: 48)
                .clipShape(RoundedRectangle(cornerRadius: 8))
        } else {
            Image(systemName: "mappin")
                .font(.system(size: 14))
                .foregroundStyle(Color.mutedText.opacity(0.5))
                .frame(width: 44, height: 44)
                .background(Color.warmBorder.opacity(0.15))
                .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }
}

// MARK: - Mini Map

/// Static map snapshot image - no controls, no "Legal" text.
private struct MiniMapSnapshot: View {
    let latitude: Double
    let longitude: Double
    let size: CGFloat
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Rectangle()
                    .fill(Color.warmBorder.opacity(0.15))
            }
        }
        .frame(width: size, height: size)
        .task { await snapshot() }
    }

    private func snapshot() async {
        let options = MKMapSnapshotter.Options()
        options.region = MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
            latitudinalMeters: 4000,
            longitudinalMeters: 4000
        )
        // Use 2x for snapshot; actual screen scale not needed for thumbnails
        options.size = CGSize(width: size * 2, height: size * 2)
        options.pointOfInterestFilter = .excludingAll
        options.showsBuildings = false

        do {
            let snapshotter = MKMapSnapshotter(options: options)
            let result = try await snapshotter.start()
            await MainActor.run { image = result.image }
        } catch {
            // Leave placeholder
        }
    }
}

// MARK: - Previews

#if DEBUG
#Preview("BirdRow") {
    ScrollView {
        BirdRow(
            speciesName: "Northern Cardinal (Cardinalis cardinalis)",
            thumbnailUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/Cardinal_-_3679055844.jpg/320px-Cardinal_-_3679055844.jpg",
            subtitle: "3 outings · 5 seen · Jan 12, 2026"
        )
        .padding(.horizontal)
        BirdRow(
            speciesName: "Blue Jay (Cyanocitta cristata)",
            thumbnailUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f4/Blue_jay_in_PP_%2830960%29.jpg/320px-Blue_jay_in_PP_%2830960%29.jpg",
            count: 3
        )
        .padding(.horizontal)
        BirdRow(
            speciesName: "Bald Eagle (Haliaeetus leucocephalus)",
            thumbnailUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/About_to_Launch_%2826075320352%29.jpg/320px-About_to_Launch_%2826075320352%29.jpg",
            subtitle: "2 outings · 2 seen · Jan 12, 2026"
        )
        .padding(.horizontal)
    }
    .background(Color.pageBg)
}

#Preview("SpeciesCard") {
    let entries = PreviewData.dex.prefix(4)
    ScrollView(.horizontal) {
        HStack(spacing: 10) {
            ForEach(Array(entries)) { entry in
                SpeciesCard(entry: entry, size: 140)
            }
        }
        .padding()
    }
    .background(Color.pageBg)
}

#Preview("OutingRow") {
    let store = previewStore()
    List(PreviewData.outings.prefix(5)) { outing in
        OutingRow(outing: outing, store: store)
    }
    .listStyle(.plain)
    .scrollContentBackground(.hidden)
    .background(Color.pageBg)
}
#endif
