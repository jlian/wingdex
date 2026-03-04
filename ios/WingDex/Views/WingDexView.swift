import SwiftUI

struct WingDexView: View {
    @Environment(DataStore.self) private var store
    @State private var searchText = ""
    @State private var sortField: DexSortField = .date
    @State private var sortAscending = false

    enum DexSortField: String, CaseIterable {
        case date, count, name
        var label: String {
            switch self {
            case .date: "Date"
            case .count: "Count"
            case .name: "Name"
            }
        }
        var icon: String {
            switch self {
            case .date: "calendar"
            case .count: "number"
            case .name: "textformat.abc"
            }
        }
    }

    private var sortedDex: [DexEntry] {
        let sorted: [DexEntry]
        switch sortField {
        case .date:
            sorted = store.dex.sorted {
                DateFormatting.sortDate($0.firstSeenDate).compare(DateFormatting.sortDate($1.firstSeenDate))
                == (sortAscending ? .orderedAscending : .orderedDescending)
            }
        case .count:
            sorted = store.dex.sorted {
                sortAscending ? $0.totalCount < $1.totalCount : $0.totalCount > $1.totalCount
            }
        case .name:
            sorted = store.dex.sorted {
                let cmp = getDisplayName($0.speciesName)
                    .localizedCaseInsensitiveCompare(getDisplayName($1.speciesName))
                return sortAscending ? cmp == .orderedAscending : cmp == .orderedDescending
            }
        }

        if searchText.isEmpty { return sorted }
        let query = searchText.lowercased()
        return sorted.filter { $0.speciesName.lowercased().contains(query) }
    }

    var body: some View {
        NavigationStack {
            Group {
                if store.dex.isEmpty {
                    VStack(spacing: 24) {
                        Spacer()
                        ZStack {
                            Circle()
                                .fill(Color.accentColor.opacity(0.1))
                                .frame(width: 80, height: 80)
                            Image("BirdLogo")
                                .renderingMode(.template)
                                .resizable()
                                .scaledToFit()
                                .frame(width: 40, height: 40)
                                .foregroundStyle(Color.accentColor)
                        }
                        VStack(spacing: 8) {
                            Text("No Species Yet")
                                .font(.system(size: 22, weight: .semibold, design: .serif))
                                .foregroundStyle(Color.foregroundText)
                            Text("Species will appear here as you identify birds.")
                                .font(.system(size: 15))
                                .foregroundStyle(Color.mutedText)
                                .multilineTextAlignment(.center)
                        }
                        Spacer()
                    }
                    .padding(.horizontal, 24)
                } else {
                    speciesList
                }
            }
            .navigationTitle("WingDex")
            .searchable(text: $searchText, prompt: "Search species")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Picker("Sort by", selection: $sortField) {
                            ForEach(DexSortField.allCases, id: \.self) { field in
                                Label(field.label, systemImage: field.icon)
                                    .tag(field)
                            }
                        }

                        Divider()

                        Button {
                            sortAscending.toggle()
                        } label: {
                            Label(
                                sortAscending ? "Ascending" : "Descending",
                                systemImage: sortAscending ? "arrow.up" : "arrow.down"
                            )
                        }
                    } label: {
                        Label("Sort", systemImage: "arrow.up.arrow.down")
                    }
                }
            }
            .refreshable {
                await store.loadAll()
            }
            .scrollContentBackground(.hidden)
            .background(Color.pageBg.ignoresSafeArea())
        }
    }

    private var speciesList: some View {
        List {
            Section {
                Text("\(store.dex.count) \(store.dex.count == 1 ? "species" : "species") in your WingDex")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .listRowBackground(Color.clear)
            }

            ForEach(sortedDex) { entry in
                NavigationLink(value: entry) {
                    DexRow(entry: entry)
                }
            }
        }
        .navigationDestination(for: DexEntry.self) { entry in
            SpeciesDetailView(speciesName: entry.speciesName)
        }
    }
}

private struct DexRow: View {
    let entry: DexEntry

    var body: some View {
        HStack(spacing: 12) {
            Group {
                if let url = entry.thumbnailUrl, let imageURL = URL(string: url) {
                    AsyncImage(url: imageURL) { phase in
                        switch phase {
                        case .success(let image):
                            image.resizable().scaledToFill()
                        default:
                            thumbnailPlaceholder
                        }
                    }
                } else {
                    thumbnailPlaceholder
                }
            }
            .frame(width: 48, height: 48)
            .clipShape(RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 3) {
                Text(getDisplayName(entry.speciesName))
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)

                if let sci = getScientificName(entry.speciesName) {
                    Text(sci)
                        .font(.caption)
                        .italic()
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Text("\(entry.totalOutings) outing\(entry.totalOutings == 1 ? "" : "s") \u{00B7} \(entry.totalCount) seen \u{00B7} \(DateFormatting.formatDate(entry.firstSeenDate, style: .medium))")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 2)
    }

    private var thumbnailPlaceholder: some View {
        Rectangle()
            .fill(.quaternary)
            .overlay {
                Image(systemName: "bird.fill")
                    .foregroundStyle(.tertiary)
            }
    }
}

#Preview {
    WingDexView()
        .environment(DataStore(service: DataService(auth: AuthService())))
}
