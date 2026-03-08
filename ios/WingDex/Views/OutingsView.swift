import SwiftUI

struct OutingsView: View {
    @Environment(DataStore.self) private var store
    @State private var searchText = ""
    @State private var sortField: OutingSortField = .date
    @State private var sortAscending = false

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
        Group {
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
                    .padding(.horizontal, 24)
                } else {
                    outingsList
                }
            }
            .navigationTitle("Outings")
            .searchable(text: $searchText, prompt: "Search outings")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
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
                }
            }
            .refreshable {
                await store.loadAll()
            }
            .scrollContentBackground(.hidden)
            .background(Color.pageBg.ignoresSafeArea())
    }

    private var outingsList: some View {
        List(sortedOutings) { outing in
            NavigationLink(value: outing) {
                OutingRow(outing: outing, store: store)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .navigationDestination(for: Outing.self) { outing in
            OutingDetailView(outingId: outing.id)
        }
    }
}

#Preview {
    OutingsView()
        .environment(DataStore(service: DataService(auth: AuthService())))
}
