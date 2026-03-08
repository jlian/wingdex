import SwiftUI

struct WingDexView: View {
    @Environment(AuthService.self) private var auth
    @Environment(DataStore.self) private var store
    @Environment(\.showSettings) private var showSettings
    @State private var searchText = ""
    @State private var sortField: DexSortField = .date
    @State private var sortAscending = false
    @State private var contextMenuSpecies: DexEntry?

    // MARK: - Sort Options

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

    // MARK: - Sorted Data

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

    // MARK: - Body

    var body: some View {
        NavigationStack {
            rootContent
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .background(Color.pageBg.ignoresSafeArea())
                .navigationTitle("WingDex")
                .toolbarTitleDisplayMode(.inlineLarge)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        // WHY HStack inside a single ToolbarItem instead of separate ToolbarItems:
                        // Multiple .topBarTrailing ToolbarItems have excessive system spacing
                        // between them (~16pt). An HStack lets us control the gap (5pt) to keep
                        // the sort button and avatar visually grouped like Apple Music.
                        HStack(spacing: 5) {
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
                            // WHY explicit .glassEffect on sort: .sharedBackgroundVisibility(.hidden)
                            // below removes the default glass from ALL items in the ToolbarItem.
                            // We add it back on the sort button only so it gets the liquid glass
                            // pill while the avatar stays flat.
                            .glassEffect(.clear.interactive())

                            Button { showSettings() } label: {
                                AvatarView(imageURL: auth.userImage, name: auth.userName, size: 40)
                            }
                            // WHY .glassEffect(.identity): renders the avatar with no visible glass
                            // effect (flat circle like Apple Music's profile button), while still
                            // participating in the shared glass layout system.
                            .glassEffect(.identity)
                        }
                        .padding(.trailing, -12)
                    }
                    // WHY .sharedBackgroundVisibility(.hidden): the default behavior gives both
                    // the sort button and avatar a SHARED glass pill background. We want them
                    // independent - sort gets its own pill, avatar is flat - so we disable the
                    // shared background and add individual .glassEffect modifiers above.
                    .sharedBackgroundVisibility(.hidden)
                }
                .refreshable {
                    await store.loadAll()
                }
                .searchable(
                    text: $searchText,
                    placement: .navigationBarDrawer(displayMode: .automatic),
                    prompt: "Search species"
                )
                .navigationDestination(for: DexEntry.self) { entry in
                    SpeciesDetailView(speciesName: entry.speciesName)
                }
                .navigationDestination(item: $contextMenuSpecies) { entry in
                    SpeciesDetailView(speciesName: entry.speciesName)
                }
        }
    }

    // MARK: - Empty State

    @ViewBuilder
    private var rootContent: some View {
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
            // WHY .frame(maxWidth/maxHeight .infinity): without this, the empty-state
            // VStack only takes its intrinsic content size, leaving white bars on the sides
            // and bottom that don't match the pageBg set on the parent NavigationStack.
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.horizontal, 24)
        } else {
            speciesList
        }
    }

    // MARK: - Species List

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
                Button {
                    contextMenuSpecies = entry
                } label: {
                    Label("View Species", systemImage: "bird")
                }
                Button {
                    UIPasteboard.general.string = entry.speciesName
                } label: {
                    Label("Copy Name", systemImage: "doc.on.doc")
                }
            } preview: {
                // WHY NavigationStack + .environment(store): context menu previews render
                // in an isolated view hierarchy outside the parent NavigationStack. Without
                // wrapping in NavigationStack, navigation titles and toolbars are missing.
                // Without .environment(store), the preview crashes because child views
                // (e.g., SpeciesDetailView) can't find the DataStore in the environment.
                NavigationStack {
                    SpeciesDetailView(speciesName: entry.speciesName)
                }
                .environment(store)
            }
        }
        .listStyle(.plain)
        .listSectionSeparator(.hidden, edges: .top)
        .scrollContentBackground(.hidden)
    }
}

#Preview("WingDex - Populated") {
    WingDexView()
        .environment(AuthService())
        .environment(previewStore())
}

#Preview("WingDex - Empty") {
    WingDexView()
        .environment(AuthService())
        .environment(previewStore(empty: true))
}
