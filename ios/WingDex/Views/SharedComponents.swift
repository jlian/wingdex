import SwiftUI

/// Portrait-aware bird thumbnail that crops tall images near the top (head area).
/// Matches web app's BirdRow thumbnail behavior.
struct BirdThumbnail: View {
    let url: String?
    var size: CGFloat = 48
    var cornerRadius: CGFloat = 8

    var body: some View {
        Group {
            if let url, let imageURL = URL(string: url) {
                AsyncImage(url: imageURL) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable()
                            .scaledToFill()
                            // Portrait images: anchor near top to show head
                            .frame(width: size, height: size, alignment: .top)
                    default:
                        placeholder
                    }
                }
            } else {
                placeholder
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
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

/// Gradient-overlay species card for horizontal scroll (Home recent species).
/// Image fills the card with species name overlaid at the bottom with gradient.
struct SpeciesCard: View {
    let entry: DexEntry
    var width: CGFloat = 120

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            BirdThumbnail(url: entry.thumbnailUrl, size: width, cornerRadius: 0)
                .frame(width: width, height: width * 0.85)

            // Gradient overlay
            LinearGradient(
                colors: [.clear, .black.opacity(0.55)],
                startPoint: .center,
                endPoint: .bottom
            )

            Text(getDisplayName(entry.speciesName))
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .truncationMode(.tail)
                .padding(.horizontal, 8)
                .padding(.bottom, 6)
        }
        .frame(width: width, height: width * 0.85)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

#Preview("BirdRow") {
    List {
        BirdRow(speciesName: "Northern Cardinal (Cardinalis cardinalis)", subtitle: "1 outing · 5 seen · Jan 1, 2026")
        BirdRow(speciesName: "Blue Jay (Cyanocitta cristata)", count: 3)
    }
    .listStyle(.plain)
}
