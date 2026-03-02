import SwiftUI

struct SpeciesDetailView: View {
    let speciesName: String
    @Environment(DataStore.self) private var store

    private var entry: DexEntry? { store.dexEntry(for: speciesName) }
    private var sightings: [(observation: BirdObservation, outing: Outing)] {
        store.sightings(for: speciesName)
    }

    var body: some View {
        List {
            heroSection
            statsSection
            sightingsSection
            linksSection
        }
        .navigationTitle(getDisplayName(speciesName))
        .navigationBarTitleDisplayMode(.inline)
        .scrollContentBackground(.hidden)
        .background(Color.pageBg.ignoresSafeArea())
    }

    // MARK: - Hero

    private var heroSection: some View {
        Section {
            ZStack(alignment: .bottomLeading) {
                Group {
                    if let url = entry?.thumbnailUrl, let imageURL = URL(string: url) {
                        AsyncImage(url: imageURL) { phase in
                            switch phase {
                            case .success(let image):
                                image.resizable().scaledToFill()
                            default:
                                heroPlaceholder
                            }
                        }
                    } else {
                        heroPlaceholder
                    }
                }
                .frame(height: 220)
                .clipped()

                // Gradient overlay with name
                LinearGradient(
                    colors: [.clear, .black.opacity(0.7)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: 100)

                VStack(alignment: .leading, spacing: 2) {
                    Text(getDisplayName(speciesName))
                        .font(.system(.title2, design: .serif, weight: .bold))
                        .foregroundStyle(.white)

                    if let sci = getScientificName(speciesName) {
                        Text(sci)
                            .font(.subheadline)
                            .italic()
                            .foregroundStyle(.white.opacity(0.8))
                    }
                }
                .padding()
            }
            .listRowInsets(EdgeInsets())
        }
    }

    private var heroPlaceholder: some View {
        Rectangle()
            .fill(.quaternary)
            .overlay {
                Image(systemName: "bird.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(.tertiary)
            }
    }

    // MARK: - Stats

    private var statsSection: some View {
        Section("Stats") {
            if let entry {
                HStack(spacing: 0) {
                    statCell(value: "\(entry.totalCount)", label: "Seen", icon: "number")
                    Divider().frame(height: 36)
                    statCell(value: "\(entry.totalOutings)", label: "Outings", icon: "binoculars")
                }

                LabeledContent("First Seen", value: DateFormatting.formatDate(entry.firstSeenDate, style: .medium))
                LabeledContent("Last Seen", value: DateFormatting.formatDate(entry.lastSeenDate, style: .medium))
            } else {
                Text("No data available")
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func statCell(value: String, label: String, icon: String) -> some View {
        VStack(spacing: 4) {
            Image(systemName: icon)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.title3.bold().monospacedDigit())
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Sightings

    private var sightingsSection: some View {
        Section("Sighting History (\(sightings.count))") {
            if sightings.isEmpty {
                Text("No sightings recorded")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(sightings, id: \.observation.id) { item in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.outing.locationName.isEmpty ? "Outing" : item.outing.locationName)
                                .font(.subheadline.weight(.medium))
                            Text(DateFormatting.formatDate(item.outing.startTime, style: .medium))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text("x\(item.observation.count)")
                            .font(.subheadline.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    // MARK: - Links

    private var linksSection: some View {
        Section("Learn More") {
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
    }
}

#Preview {
    NavigationStack {
        SpeciesDetailView(speciesName: "Northern Cardinal (Cardinalis cardinalis)")
            .environment(DataStore(service: DataService(auth: AuthService())))
    }
}
