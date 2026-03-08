import SwiftUI

struct HomeView: View {
    @Environment(AuthService.self) private var auth
    @Environment(DataStore.self) private var store
    @Environment(\.showAddPhotos) private var showAddPhotos
    @Environment(\.showSettings) private var showSettings

    var body: some View {
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
            ToolbarItem(placement: .topBarTrailing) {
                Button { showSettings() } label: {
                    AvatarView(imageURL: auth.userImage, name: auth.userName, size: 34)
                        .glassEffect(.regular.interactive())
                }
            }
        }
        .refreshable {
            await store.loadAll()
        }
        .scrollContentBackground(.hidden)
        .background(Color.pageBg.ignoresSafeArea())
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
                showAddPhotos()
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
            Section {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("\(store.dex.count)")
                        .font(.system(size: 48, weight: .semibold, design: .serif))
                        .foregroundStyle(Color.foregroundText)
                    Text("species observed")
                        .font(.system(size: 18, design: .serif))
                        .italic()
                        .foregroundStyle(Color.mutedText)
                }
            }
            .listRowSeparator(.hidden)

            // Recent species - horizontal scroll with gradient cards
            let recentSpecies = store.recentSpecies()
            if !recentSpecies.isEmpty {
                Section {
                    Text("Recent Species")
                        .font(.system(size: 18, weight: .semibold, design: .serif))
                        .foregroundStyle(Color.foregroundText)
                        .listRowSeparator(.hidden)

                    GeometryReader { geo in
                        let spacing: CGFloat = 10
                        let padding: CGFloat = 16
                        let cardSize = (geo.size.width - padding * 2 - spacing * 2) / 2.25
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: spacing) {
                                ForEach(recentSpecies) { entry in
                                    NavigationLink(value: entry) {
                                        SpeciesCard(entry: entry, size: cardSize)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.horizontal, padding)
                        }
                        .frame(height: cardSize)
                    }
                    .aspectRatio(2.25, contentMode: .fit)
                    .listRowInsets(EdgeInsets())
                    .listRowSeparator(.hidden)
                }
            }

            // Recent outings
            let recentOutings = store.recentOutings()
            if !recentOutings.isEmpty {
                Section {
                    Text("Recent Outings")
                        .font(.system(size: 18, weight: .semibold, design: .serif))
                        .foregroundStyle(Color.foregroundText)
                        .listRowSeparator(.hidden)

                    ForEach(recentOutings) { outing in
                        NavigationLink(value: outing) {
                            OutingRow(outing: outing, store: store)
                        }
                        .contextMenu {
                            Button(role: .destructive) {
                                Task { try? await store.deleteOuting(id: outing.id) }
                            } label: {
                                Label("Delete Outing", systemImage: "trash")
                            }
                        } preview: {
                            OutingDetailView(outingId: outing.id)
                                .environment(store)
                        }
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .listSectionSeparator(.hidden)
        .navigationDestination(for: DexEntry.self) { entry in
            SpeciesDetailView(speciesName: entry.speciesName)
        }
        .navigationDestination(for: Outing.self) { outing in
            OutingDetailView(outingId: outing.id)
        }
    }
}

#Preview {
    HomeView()
        .environment(DataStore(service: DataService(auth: AuthService())))
}
