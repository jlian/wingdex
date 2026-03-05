import SwiftUI

struct SpeciesDetailView: View {
    let speciesName: String
    @Environment(DataStore.self) private var store
    @State private var wikiExtract: String?
    @State private var fullImageUrl: String?

    private var entry: DexEntry? { store.dexEntry(for: speciesName) }
    private var sightings: [(observation: BirdObservation, outing: Outing)] {
        store.sightings(for: speciesName)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                heroSection
                contentSection
            }
        }
        .navigationTitle(getDisplayName(speciesName))
        .navigationBarTitleDisplayMode(.inline)
        .background(Color.pageBg.ignoresSafeArea())
        .navigationDestination(for: Outing.self) { outing in
            OutingDetailView(outingId: outing.id)
        }
        .task { await fetchWikipediaData() }
    }

    // MARK: - Hero

    private var heroSection: some View {
        GeometryReader { geo in
            ZStack(alignment: .bottomLeading) {
                Group {
                    let imageUrl = fullImageUrl ?? entry?.thumbnailUrl
                    if let url = imageUrl, let imageURL = URL(string: url) {
                        AsyncImage(url: imageURL) { phase in
                            switch phase {
                            case .success(let image):
                                image.resizable()
                                    .scaledToFill()
                                    .frame(width: geo.size.width, height: 280, alignment: .top)
                                    .clipped()
                            default:
                                heroPlaceholder
                            }
                        }
                    } else {
                        heroPlaceholder
                    }
                }
                .frame(width: geo.size.width, height: 280)
                .clipped()

            // Gradient overlay
            LinearGradient(
                colors: [.clear, .clear, .black.opacity(0.6)],
                startPoint: .top,
                endPoint: .bottom
            )

            // Name + stats overlay
            VStack(alignment: .leading, spacing: 4) {
                Text(getDisplayName(speciesName))
                    .font(.system(size: 26, weight: .semibold, design: .serif))
                    .foregroundStyle(.white)

                if let sci = getScientificName(speciesName) {
                    Text(sci)
                        .font(.system(size: 14))
                        .italic()
                        .foregroundStyle(.white.opacity(0.75))
                }

                if let entry {
                    HStack(spacing: 4) {
                        Text("\(entry.totalCount) seen")
                            .fontWeight(.semibold)
                            .foregroundStyle(.white)
                        Text("\u{00B7}").foregroundStyle(.white.opacity(0.4))
                        Text("\(entry.totalOutings) outing\(entry.totalOutings == 1 ? "" : "s")")
                            .fontWeight(.semibold)
                            .foregroundStyle(.white)
                        Text("\u{00B7}").foregroundStyle(.white.opacity(0.4))
                        Text("First ")
                            .foregroundStyle(.white.opacity(0.7))
                        + Text(DateFormatting.formatDate(entry.firstSeenDate, style: .medium))
                            .fontWeight(.semibold)
                            .foregroundStyle(.white)
                    }
                    .font(.system(size: 13))
                }
            }
            .padding()
        }
        .frame(width: geo.size.width, height: 280)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .frame(height: 280)
        .padding(.horizontal)
    }

    private var heroPlaceholder: some View {
        Rectangle()
            .fill(Color.warmBorder.opacity(0.3))
            .overlay {
                Image(systemName: "bird.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(Color.mutedText.opacity(0.3))
            }
    }

    // MARK: - Content

    private var contentSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Wikipedia description
            if let extract = wikiExtract {
                VStack(alignment: .leading, spacing: 8) {
                    Text(extract)
                        .font(.system(size: 14))
                        .foregroundStyle(Color.foregroundText.opacity(0.8))
                        .lineSpacing(3)

                    if entry?.wikiTitle != nil {
                        (Text("Source: ")
                            .foregroundStyle(Color.mutedText.opacity(0.6))
                        + Text("Wikipedia")
                            .foregroundStyle(Color.accentColor)
                        + Text(". Text and images available under ")
                            .foregroundStyle(Color.mutedText.opacity(0.6))
                        + Text("CC BY-SA 4.0")
                            .foregroundStyle(Color.accentColor)
                        + Text(".")
                            .foregroundStyle(Color.mutedText.opacity(0.6)))
                        .font(.system(size: 11))
                    }
                }
                .padding()
            }

            // Links - left justified
            HStack(spacing: 10) {
                if let entry, let wikiTitle = entry.wikiTitle {
                    linkButton("Wikipedia", icon: "book", url: "https://en.wikipedia.org/wiki/\(wikiTitle.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? wikiTitle)")
                }

                let commonName = getDisplayName(speciesName)
                    .addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
                linkButton("eBird", icon: "globe", url: "https://ebird.org/species/\(commonName)")
                linkButton("All About Birds", icon: "info.circle", url: "https://www.allaboutbirds.org/guide/\(commonName.replacingOccurrences(of: "%20", with: "_"))")

                Spacer()
            }
            .padding(.horizontal)
            .padding(.bottom, 12)

            // Sightings - clickable
            VStack(alignment: .leading, spacing: 0) {
                Text("SIGHTINGS (\(sightings.count))")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color.mutedText)
                    .padding(.horizontal)
                    .padding(.vertical, 12)

                ForEach(sightings, id: \.observation.id) { item in
                    NavigationLink(value: item.outing) {
                        HStack {
                            Image(systemName: "calendar")
                                .font(.caption)
                                .foregroundStyle(Color.mutedText)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.outing.locationName.isEmpty ? "Outing" : item.outing.locationName)
                                    .font(.system(size: 14, weight: .semibold, design: .serif))
                                    .foregroundStyle(Color.foregroundText)
                                Text("\(DateFormatting.formatDate(item.outing.startTime, style: .medium)) \u{00B7} Confirmed")
                                    .font(.system(size: 12))
                                    .foregroundStyle(Color.mutedText)
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.caption)
                                .foregroundStyle(Color.mutedText.opacity(0.4))
                        }
                        .padding(.horizontal)
                        .padding(.vertical, 10)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.pressHighlight)

                    if item.observation.id != sightings.last?.observation.id {
                        Divider().padding(.leading, 44)
                    }
                }
            }
        }
    }

    // MARK: - Links

    private func linkButton(_ title: String, icon: String, url: String) -> some View {
        Link(destination: URL(string: url)!) {
            Label(title, systemImage: icon)
                .font(.system(size: 13))
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color.cardBg)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.warmBorder, lineWidth: 0.5)
                )
        }
    }

    // MARK: - Wikipedia Fetch

    private func fetchWikipediaData() async {
        guard let wikiTitle = entry?.wikiTitle else { return }
        let encoded = wikiTitle.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? wikiTitle
        guard let url = URL(string: "https://en.wikipedia.org/api/rest_v1/page/summary/\(encoded)") else { return }

        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
                await MainActor.run {
                    wikiExtract = json["extract"] as? String
                    if let original = json["originalimage"] as? [String: Any],
                       let src = original["source"] as? String {
                        fullImageUrl = src
                    }
                }
            }
        } catch {
            // Silently fail - the thumbnail from dex is still shown
        }
    }
}

#Preview {
    NavigationStack {
        SpeciesDetailView(speciesName: "Northern Cardinal (Cardinalis cardinalis)")
            .environment(DataStore(service: DataService(auth: AuthService())))
    }
}
