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
        List {
            // Hero image section - no separators, full bleed
            Section {
                heroSection
                    .listRowInsets(EdgeInsets())
            }
            .listRowSeparator(.hidden)

            // Wikipedia + links section
            if wikiExtract != nil || entry != nil {
                Section {
                    wikiSection
                }
                .listRowSeparator(.hidden)

                Section {
                    linksSection
                }
            }

            // Sightings section
            Section {
                ForEach(sightings, id: \.observation.id) { item in
                    NavigationLink(value: item.outing) {
                        OutingRow(outing: item.outing, store: store)
                    }
                    .contextMenu {
                        Button(role: .destructive) {
                            Task { await store.deleteOuting(id: item.outing.id) }
                        } label: {
                            Label("Delete Outing", systemImage: "trash")
                        }
                    } preview: {
                        NavigationStack {
                            OutingDetailView(outingId: item.outing.id)
                        }
                        .environment(store)
                    }
                }
            } header: {
                Text("Sightings (\(sightings.count))")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color.mutedText)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
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
                    .foregroundStyle(.white.opacity(0.9))

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
                            .foregroundStyle(.white.opacity(0.9))
                        Text("\u{00B7}").foregroundStyle(.white.opacity(0.4))
                        Text("\(entry.totalOutings) outing\(entry.totalOutings == 1 ? "" : "s")")
                            .fontWeight(.semibold)
                            .foregroundStyle(.white.opacity(0.9))
                        Text("\u{00B7}").foregroundStyle(.white.opacity(0.4))
                        Text("First \(Text(DateFormatting.formatDate(entry.firstSeenDate, style: .medium)).fontWeight(.semibold).foregroundStyle(.white.opacity(0.9)))")
                            .foregroundStyle(.white.opacity(0.7))
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

    // MARK: - Wiki

    @ViewBuilder
    private var wikiSection: some View {
        if let extract = wikiExtract {
            VStack(alignment: .leading, spacing: 8) {
                Text(extract)
                    .font(.system(size: 14))
                    .foregroundStyle(Color.foregroundText.opacity(0.8))
                    .lineSpacing(3)

                if entry?.wikiTitle != nil {
                    Text("Source: \(Text("Wikipedia").foregroundStyle(Color.accentColor)). Text and images available under \(Text("CC BY-SA 4.0").foregroundStyle(Color.accentColor)).")
                        .font(.system(size: 11))
                        .foregroundStyle(Color.mutedText.opacity(0.6))
                }
            }
        }
    }

    // MARK: - Links

    @ViewBuilder
    private var linksSection: some View {
        if let entry, let wikiTitle = entry.wikiTitle {
            Link(destination: URL(string: "https://en.wikipedia.org/wiki/\(wikiTitle.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? wikiTitle)")!) {
                Label("Wikipedia", systemImage: "book")
            }
        }

        let commonName = getDisplayName(speciesName)
            .addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        Link(destination: URL(string: "https://ebird.org/species/\(commonName)")!) {
            Label("eBird", systemImage: "globe")
        }
        Link(destination: URL(string: "https://www.allaboutbirds.org/guide/\(commonName.replacingOccurrences(of: "%20", with: "_"))")!) {
            Label("All About Birds", systemImage: "info.circle")
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
