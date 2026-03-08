import SwiftUI

struct WingDexView: View {
    @Environment(AuthService.self) private var auth
    @Environment(DataStore.self) private var store
    @Environment(\.showSettings) private var showSettings
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
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(.horizontal, 24)
                } else {
                    speciesList
                }
            }
            .navigationTitle("WingDex")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $searchText, prompt: "Search species")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
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
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings() } label: {
                        AvatarView(imageURL: auth.userImage, name: auth.userName, size: 34)
                    }
                }
                .sharedBackgroundVisibility(.hidden)
            }
            .refreshable {
                await store.loadAll()
            }
            .scrollContentBackground(.hidden)
            .background(Color.pageBg.ignoresSafeArea())
    }

    private var speciesList: some View {
        List(sortedDex) { entry in
            NavigationLink(value: entry) {
                BirdRow(
                    speciesName: entry.speciesName,
                    thumbnailUrl: entry.thumbnailUrl,
                    subtitle: "\(entry.totalOutings) outing\(entry.totalOutings == 1 ? "" : "s") \u{00B7} \(entry.totalCount) seen \u{00B7} \(DateFormatting.formatDate(entry.firstSeenDate, style: .medium))"
                )
            }
            .contextMenu {
                if let ebirdName = entry.speciesName.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
                   let url = URL(string: "https://ebird.org/species/\(ebirdName.lowercased().replacingOccurrences(of: "%20", with: "_"))") {
                    Link(destination: url) {
                        Label("Open in eBird", systemImage: "bird")
                    }
                }
                if let wikiName = entry.speciesName.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
                   let url = URL(string: "https://en.wikipedia.org/wiki/\(wikiName)") {
                    Link(destination: url) {
                        Label("Open in Wikipedia", systemImage: "book")
                    }
                }
                Button {
                    UIPasteboard.general.string = entry.speciesName
                } label: {
                    Label("Copy Name", systemImage: "doc.on.doc")
                }
            } preview: {
                NavigationStack {
                    SpeciesDetailView(speciesName: entry.speciesName)
                }
                .environment(store)
            }
        }
        .listStyle(.plain)
        .listSectionSeparator(.hidden)
        .scrollContentBackground(.hidden)
        .navigationDestination(for: DexEntry.self) { entry in
            SpeciesDetailView(speciesName: entry.speciesName)
        }
    }
}

#Preview {
    WingDexView()
        .environment(DataStore(service: DataService(auth: AuthService())))
}
