import SwiftUI
import MapKit

/// In-memory image cache shared across all thumbnails to avoid re-downloads on scroll.
@MainActor
private final class ImageCache {
    static let shared = ImageCache()
    private var cache = NSCache<NSString, UIImage>()
    init() { cache.countLimit = 200 }

    func image(for key: String) -> UIImage? { cache.object(forKey: key as NSString) }
    func set(_ image: UIImage, for key: String) { cache.setObject(image, forKey: key as NSString) }
}

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
                    .font(.system(size: 14, weight: .semibold, design: .serif))
                    .foregroundStyle(Color.foregroundText)
                    .lineLimit(1)

                if let sci = getScientificName(speciesName) {
                    Text(sci)
                        .font(.system(size: 12))
                        .italic()
                        .foregroundStyle(Color.mutedText)
                        .lineLimit(1)
                }

                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 12))
                        .foregroundStyle(Color.mutedText.opacity(0.7))
                        .lineLimit(1)
                }

                if let count, count > 1 {
                    Text("x\(count)")
                        .font(.system(size: 12))
                        .foregroundStyle(Color.mutedText)
                }
            }

            Spacer()
        }
        .contentShape(Rectangle())
        .padding(.vertical, 2)
    }
}

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
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.white.opacity(0.9))
                .lineLimit(2)
                .padding(.horizontal, 8)
                .padding(.bottom, 6)
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

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

            VStack(alignment: .leading, spacing: 3) {
                Text(outing.locationName.isEmpty ? "Outing" : outing.locationName)
                    .font(.system(size: 14, weight: .semibold, design: .serif))
                    .foregroundStyle(Color.foregroundText)
                    .lineLimit(1)

                Text("\(DateFormatting.formatDate(outing.startTime, style: .medium)) \u{00B7} \(speciesNames.count) species")
                    .font(.system(size: 12))
                    .foregroundStyle(Color.mutedText)

                if !speciesNames.isEmpty {
                    Text(
                        speciesNames.prefix(4).map { getDisplayName($0) }.joined(separator: ", ")
                        + (speciesNames.count > 4 ? " +\(speciesNames.count - 4) more" : "")
                    )
                    .font(.system(size: 12))
                    .foregroundStyle(Color.mutedText.opacity(0.7))
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
            MiniMapSnapshot(latitude: lat, longitude: lon, size: 44)
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
        let scale = UIScreen.main.scale
        options.size = CGSize(width: size * scale, height: size * scale)
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

#Preview("BirdRow") {
    ScrollView {
        BirdRow(speciesName: "Northern Cardinal (Cardinalis cardinalis)", subtitle: "1 outing · 5 seen · Jan 1, 2026")
            .padding(.horizontal)
        BirdRow(speciesName: "Blue Jay (Cyanocitta cristata)", count: 3)
            .padding(.horizontal)
    }
    .background(Color.pageBg)
}
