import SwiftUI

struct OutingsView: View {
    @Environment(AuthService.self) private var auth
    @Environment(DataStore.self) private var store
    @Environment(\.showSettings) private var showSettings
    @State private var searchText = ""
    @State private var sortField: OutingSortField = .date
    @State private var sortAscending = false
    @State private var contextMenuOuting: Outing?

    enum OutingSortField: String, CaseIterable {
        case date, species, name
        var label: String {
            switch self {
            case .date: "Date"
            case .species: "Species"
            case .name: "Name"
            }
        }
        var icon: String {
            switch self {
            case .date: "calendar"
            case .species: "bird"
            case .name: "textformat.abc"
            }
        }
    }

    private var sortedOutings: [Outing] {
        let sorted: [Outing]
        switch sortField {
        case .date:
            sorted = store.outings.sorted {
                DateFormatting.sortDate($0.startTime).compare(DateFormatting.sortDate($1.startTime))
                == (sortAscending ? .orderedAscending : .orderedDescending)
            }
        case .species:
            sorted = store.outings.sorted {
                let a = store.speciesCount(for: $0.id)
                let b = store.speciesCount(for: $1.id)
                return sortAscending ? a < b : a > b
            }
        case .name:
            sorted = store.outings.sorted {
                let cmp = $0.locationName.localizedCaseInsensitiveCompare($1.locationName)
                return sortAscending ? cmp == .orderedAscending : cmp == .orderedDescending
            }
        }

        if searchText.isEmpty { return sorted }
        return sorted.filter {
            $0.locationName.localizedCaseInsensitiveContains(searchText)
        }
    }

    var body: some View {
        NavigationStack {
            rootContent
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .background(Color.pageBg.ignoresSafeArea())
                .navigationTitle("Outings")
                .toolbarTitleDisplayMode(.inlineLarge)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        HStack {
                            Menu {
                                Picker("Sort by", selection: $sortField) {
                                    ForEach(OutingSortField.allCases, id: \.self) { field in
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
                            .glassEffect(.regular.interactive())

                            Button { showSettings() } label: {
                                AvatarView(imageURL: auth.userImage, name: auth.userName, size: 40)
                            }
                        }
                        .padding(.trailing, -20)
                    }
                    .sharedBackgroundVisibility(.hidden)
                }
                .refreshable {
                    await store.loadAll()
                }
                .searchable(
                    text: $searchText,
                    placement: .navigationBarDrawer(displayMode: .automatic),
                    prompt: "Search outings"
                )
                .navigationDestination(for: Outing.self) { outing in
                    OutingDetailView(outingId: outing.id)
                }
                .navigationDestination(item: $contextMenuOuting) { outing in
                    OutingDetailView(outingId: outing.id)
                }
        }
    }

    @ViewBuilder
    private var rootContent: some View {
        if store.outings.isEmpty {
            VStack(spacing: 24) {
                Spacer()
                ZStack {
                    Circle()
                        .fill(Color.accentColor.opacity(0.1))
                        .frame(width: 80, height: 80)
                    Image(systemName: "binoculars.fill")
                        .font(.system(size: 32))
                        .foregroundStyle(Color.accentColor)
                }
                VStack(spacing: 8) {
                    Text("No Outings Yet")
                        .font(.system(size: 22, weight: .semibold, design: .serif))
                        .foregroundStyle(Color.foregroundText)
                    Text("Upload photos to create your first outing.")
                        .font(.system(size: 15))
                        .foregroundStyle(Color.mutedText)
                        .multilineTextAlignment(.center)
                }
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.horizontal, 24)
        } else {
            outingsList
        }
    }

    private var outingsList: some View {
        List(sortedOutings) { outing in
            NavigationLink(value: outing) {
                OutingRow(outing: outing, store: store)
            }
            .contextMenu {
                Button {
                    contextMenuOuting = outing
                } label: {
                    Label("View Outing", systemImage: "binoculars")
                }
                if let lat = outing.lat, let lon = outing.lon {
                    Button {
                        openInMaps(outing: outing, lat: lat, lon: lon)
                    } label: {
                        Label("View in Maps", systemImage: "map")
                    }
                }
            } preview: {
                NavigationStack {
                    OutingDetailView(outingId: outing.id)
                }
                .environment(store)
            }
        }
        .listStyle(.plain)
        .listSectionSeparator(.hidden, edges: .top)
        .scrollContentBackground(.hidden)
    }
}

#Preview {
    OutingsView()
        .environment(DataStore(service: DataService(auth: AuthService())))
}
