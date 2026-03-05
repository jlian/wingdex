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
            .navigationTitle("Home")
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
        VStack(spacing: 24) {
            Spacer()

            // Bird icon in circular tinted background - matches web layout
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

            VStack(spacing: 12) {
                Text("Got bird pics?")
                    .font(.system(size: 30, weight: .semibold, design: .serif))
                    .foregroundStyle(Color.foregroundText)

                Text("Upload your photos, ID the birds, and build your WingDex.")
                    .font(.system(size: 16))
                    .foregroundStyle(Color.mutedText)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button {
                showingAddPhotos = true
            } label: {
                Label {
                    Text("Upload & Identify")
                        .font(.system(size: 16, weight: .medium))
                } icon: {
                    Image(systemName: "camera.fill")
                        .font(.system(size: 16))
                }
                .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .tint(Color.accentColor)
            .padding(.horizontal, 32)

            Spacer()
        }
        .padding(.horizontal, 24)
    }

    // MARK: - Data View

    private var dataView: some View {
        List {
            // Hero stats
            VStack(alignment: .leading, spacing: 2) {
                Text("\(store.dex.count)")
                    .font(.system(size: 48, weight: .semibold, design: .serif))
                    .foregroundStyle(Color.foregroundText)
                Text("species observed")
                    .font(.system(size: 18, design: .serif))
                    .italic()
                    .foregroundStyle(Color.mutedText)
            }
            .listRowSeparator(.hidden)
            .listRowBackground(Color.pageBg)

            // Recent species - horizontal scroll with gradient cards
            let recentSpecies = store.recentSpecies()
            if !recentSpecies.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Recent Species")
                        .font(.system(size: 18, weight: .semibold, design: .serif))

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(recentSpecies) { entry in
                                NavigationLink(value: entry) {
                                    SpeciesCard(entry: entry)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .listRowSeparator(.hidden)
                .listRowBackground(Color.pageBg)
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 0))
            }

            // Recent outings
            let recentOutings = store.recentOutings()
            if !recentOutings.isEmpty {
                Text("Recent Outings")
                    .font(.system(size: 18, weight: .semibold, design: .serif))
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.pageBg)

                ForEach(recentOutings) { outing in
                    NavigationLink(value: outing) {
                        OutingRow(outing: outing, store: store)
                    }
                    .listRowBackground(Color.pageBg)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Color.pageBg)
        .navigationDestination(for: DexEntry.self) { entry in
            SpeciesDetailView(speciesName: entry.speciesName)
        }
        .navigationDestination(for: Outing.self) { outing in
            OutingDetailView(outingId: outing.id)
        }
    }
}

/// Reusable outing row - used in HomeView and OutingsView.
/// Styled like iOS Messages/Mail: icon, bold title, secondary metadata, tertiary preview.
struct OutingRow: View {
    let outing: Outing
    let store: DataStore

    var body: some View {
        let confirmed = store.confirmedObservations(outing.id)
        let speciesNames = Array(Set(confirmed.map(\.speciesName))).sorted()

        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "mappin.circle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.accentColor)
                .frame(width: 28)
                .padding(.top, 2)

            VStack(alignment: .leading, spacing: 3) {
                Text(outing.locationName.isEmpty ? "Outing" : outing.locationName)
                    .font(.system(size: 14, weight: .semibold, design: .serif))
                    .foregroundStyle(Color.foregroundText)
                    .lineLimit(1)

                Text("\(DateFormatting.formatDate(outing.startTime, style: .medium)) \u{00B7} \(speciesNames.count) species")
                    .font(.system(size: 12))
                    .foregroundStyle(Color.mutedText)

                if !speciesNames.isEmpty {
                    Text(
                        speciesNames.prefix(4).map { getDisplayName($0) }.joined(separator: ", ")
                        + (speciesNames.count > 4 ? " +\(speciesNames.count - 4) more" : "")
                    )
                    .font(.system(size: 12))
                    .foregroundStyle(Color.mutedText.opacity(0.7))
                    .lineLimit(1)
                }
            }
        }
        .padding(.vertical, 2)
    }
}

#Preview {
    HomeView(showingAddPhotos: .constant(false))
        .environment(DataStore(service: DataService(auth: AuthService())))
}
