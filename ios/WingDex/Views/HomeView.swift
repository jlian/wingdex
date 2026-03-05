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
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
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
                .padding(.horizontal)

                // Recent species - horizontal scroll with gradient cards
                let recentSpecies = store.recentSpecies()
                if !recentSpecies.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Recent Species")
                            .font(.system(size: 18, weight: .semibold, design: .serif))
                            .padding(.horizontal)

                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 10) {
                                ForEach(recentSpecies) { entry in
                                    NavigationLink(value: entry) {
                                        SpeciesCard(entry: entry)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.horizontal)
                        }
                    }
                }

                // Recent outings
                let recentOutings = store.recentOutings()
                if !recentOutings.isEmpty {
                    Text("Recent Outings")
                        .font(.system(size: 18, weight: .semibold, design: .serif))
                        .padding(.horizontal)

                    VStack(spacing: 0) {
                        ForEach(Array(recentOutings.enumerated()), id: \.element.id) { index, outing in
                            NavigationLink(value: outing) {
                                OutingRow(outing: outing, store: store)
                                    .padding(.horizontal)
                                    .padding(.vertical, 10)
                            }
                            .buttonStyle(.scrollRow)
                            if index < recentOutings.count - 1 {
                                Divider().padding(.leading, 72)
                            }
                        }
                    }
                }
            }
            .padding(.vertical)
        }
        .navigationDestination(for: DexEntry.self) { entry in
            SpeciesDetailView(speciesName: entry.speciesName)
        }
        .navigationDestination(for: Outing.self) { outing in
            OutingDetailView(outingId: outing.id)
        }
    }
}

#Preview {
    HomeView(showingAddPhotos: .constant(false))
        .environment(DataStore(service: DataService(auth: AuthService())))
}
