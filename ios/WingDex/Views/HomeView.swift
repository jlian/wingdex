import SwiftUI

struct HomeView: View {
    @Binding var showingAddPhotos: Bool
    @Environment(DataStore.self) private var store

    var body: some View {
        NavigationStack {
            Group {
                if store.isLoading && store.dex.isEmpty {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if store.dex.isEmpty {
                    emptyState
                } else {
                    dataView
                }
            }
            .navigationTitle("WingDex")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showingAddPhotos = true
                    } label: {
                        Label("Add Photos", systemImage: "plus.circle.fill")
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

    // MARK: - Empty State

    private var emptyState: some View {
        ContentUnavailableView {
            Label("Got bird pics?", systemImage: "bird.fill")
                .font(.system(.title, design: .serif))
        } description: {
            Text("Upload your photos, ID the birds, and build your WingDex.")
        } actions: {
            Button {
                showingAddPhotos = true
            } label: {
                Label("Upload & Identify", systemImage: "camera.fill")
            }
            .buttonStyle(.borderedProminent)
            .tint(Color.accentColor)
        }
    }

    // MARK: - Data View

    private var dataView: some View {
        List {
            // Hero stats
            Section {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(store.dex.count)")
                            .font(.system(size: 48, weight: .bold, design: .rounded))
                            .foregroundStyle(Color.accentColor)
                        Text("species observed")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
                .padding(.vertical, 4)
            }

            // Recent species grid
            let recentSpecies = store.recentSpecies()
            if !recentSpecies.isEmpty {
                Section("Recent Species") {
                    LazyVGrid(columns: [
                        GridItem(.flexible()),
                        GridItem(.flexible()),
                        GridItem(.flexible()),
                    ], spacing: 8) {
                        ForEach(recentSpecies) { entry in
                            NavigationLink(value: entry) {
                                SpeciesCard(entry: entry)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                }
            }

            // Recent outings
            let recentOutings = store.recentOutings()
            if !recentOutings.isEmpty {
                Section("Recent Outings") {
                    ForEach(recentOutings) { outing in
                        NavigationLink(value: outing) {
                            OutingRow(outing: outing, store: store)
                        }
                    }
                }
            }
        }
        .navigationDestination(for: DexEntry.self) { entry in
            SpeciesDetailView(speciesName: entry.speciesName)
        }
        .navigationDestination(for: Outing.self) { outing in
            OutingDetailView(outingId: outing.id)
        }
    }
}

// MARK: - Subviews

private struct SpeciesCard: View {
    let entry: DexEntry

    var body: some View {
        VStack(spacing: 0) {
            Group {
                if let url = entry.thumbnailUrl, let imageURL = URL(string: url) {
                    AsyncImage(url: imageURL) { phase in
                        switch phase {
                        case .success(let image):
                            image.resizable().scaledToFill()
                        case .failure:
                            thumbnailPlaceholder
                        default:
                            thumbnailPlaceholder
                        }
                    }
                } else {
                    thumbnailPlaceholder
                }
            }
            .frame(height: 80)
            .clipped()

            Text(getDisplayName(entry.speciesName))
                .font(.caption2.weight(.semibold))
                .lineLimit(1)
                .truncationMode(.tail)
                .padding(.horizontal, 6)
                .padding(.vertical, 4)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
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

/// Reusable outing row - used in HomeView and OutingsView.
struct OutingRow: View {
    let outing: Outing
    let store: DataStore

    var body: some View {
        let confirmed = store.confirmedObservations(outing.id)
        let speciesNames = Array(Set(confirmed.map(\.speciesName)))

        VStack(alignment: .leading, spacing: 4) {
            Text(outing.locationName.isEmpty ? "Outing" : outing.locationName)
                .font(.headline)

            HStack(spacing: 4) {
                Text(DateFormatting.relativeDate(outing.startTime))
                Text("·")
                Text("\(speciesNames.count) species")
            }
            .font(.caption)
            .foregroundStyle(.secondary)

            if !speciesNames.isEmpty {
                Text(
                    speciesNames.prefix(3).map { getDisplayName($0) }.joined(separator: ", ")
                    + (speciesNames.count > 3 ? " +\(speciesNames.count - 3)" : "")
                )
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
        }
    }
}

#Preview {
    HomeView(showingAddPhotos: .constant(false))
        .environment(DataStore(service: DataService(auth: AuthService())))
}
