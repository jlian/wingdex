import SwiftUI
import UIKit

struct HomeView: View {
    @Environment(AuthService.self) private var auth
    @Environment(DataStore.self) private var store
    @Environment(\.showAddPhotos) private var showAddPhotos
    @Environment(\.showWingDex) private var showWingDex
    @Environment(\.showOutings) private var showOutings
    @Environment(\.showSettings) private var showSettings
    @State private var committedSpeciesEntry: DexEntry?

    var body: some View {
        NavigationStack {
            rootContent
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .navigationSurface()
                .navigationTitle("Home")
                .toolbarTitleDisplayMode(.inlineLarge)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { showSettings() } label: {
                            AvatarView(imageURL: auth.userImage, name: auth.userName, size: 40)
                        }
                        .padding(.trailing, -20)
                    }
                    .sharedBackgroundVisibility(.hidden)
                }
                .refreshable {
                    await store.loadAll()
                }
                .navigationDestination(for: DexEntry.self) { entry in
                    SpeciesDetailView(speciesName: entry.speciesName)
                }
                .navigationDestination(for: Outing.self) { outing in
                    OutingDetailView(outingId: outing.id)
                }
                .navigationDestination(item: $committedSpeciesEntry) { entry in
                    SpeciesDetailView(speciesName: entry.speciesName)
                }
        }
    }

    @ViewBuilder
    private var rootContent: some View {
        if store.isLoading && store.dex.isEmpty {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if store.dex.isEmpty {
            emptyState
        } else {
            dataView
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
                    Button {
                        showWingDex()
                    } label: {
                        HStack(spacing: 5) {
                            Text("Recent Species")
                                .font(.system(size: 18, weight: .semibold, design: .serif))
                            Image(systemName: "chevron.right")
                                .font(.system(size: 12, weight: .semibold))
                        }
                        .foregroundStyle(Color.foregroundText)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .listRowSeparator(.hidden)
                    .buttonStyle(.plain)
                    .accessibilityLabel("Open WingDex")

                    GeometryReader { geo in
                        let spacing: CGFloat = 10
                        let padding: CGFloat = 16
                        let cardSize = (geo.size.width - padding * 2 - spacing * 2) / 2.25
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: spacing) {
                                ForEach(recentSpecies) { entry in
                                    PeekPopContextMenu(
                                        menu: speciesContextMenu(for: entry),
                                        onTap: {
                                            committedSpeciesEntry = entry
                                        }
                                    ) {
                                        SpeciesCard(entry: entry, size: cardSize)
                                    } preview: {
                                        NavigationStack {
                                            SpeciesDetailView(speciesName: entry.speciesName)
                                        }
                                        .environment(store)
                                    }
                                    .frame(width: cardSize, height: cardSize)
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
                    Button {
                        showOutings()
                    } label: {
                        HStack(spacing: 5) {
                            Text("Recent Outings")
                                .font(.system(size: 18, weight: .semibold, design: .serif))
                            Image(systemName: "chevron.right")
                                .font(.system(size: 12, weight: .semibold))
                        }
                        .foregroundStyle(Color.foregroundText)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .listRowSeparator(.hidden)
                    .buttonStyle(.plain)
                    .accessibilityLabel("Open Outings")

                    ForEach(recentOutings) { outing in
                        NavigationLink(value: outing) {
                            OutingRow(outing: outing, store: store)
                        }
                        .contextMenu {
                            Button(role: .destructive) {
                                Task { await store.deleteOuting(id: outing.id) }
                            } label: {
                                Label("Delete Outing", systemImage: "trash")
                            }
                        } preview: {
                            NavigationStack {
                                OutingDetailView(outingId: outing.id)
                            }
                            .environment(store)
                        }
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .listSectionSeparator(.hidden, edges: .top)
    }

    private func speciesContextMenu(for entry: DexEntry) -> UIMenu {
        var actions: [UIMenuElement] = []

        if let url = getEbirdURL(for: entry.speciesName) {
            actions.append(UIAction(title: "Open in eBird", image: UIImage(systemName: "bird")) { _ in
                UIApplication.shared.open(url)
            })
        }

        if let wikiName = entry.speciesName.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
           let url = URL(string: "https://en.wikipedia.org/wiki/\(wikiName)") {
            actions.append(UIAction(title: "Open in Wikipedia", image: UIImage(systemName: "book")) { _ in
                UIApplication.shared.open(url)
            })
        }

        actions.append(UIAction(title: "Copy Name", image: UIImage(systemName: "doc.on.doc")) { _ in
            UIPasteboard.general.string = entry.speciesName
        })

        return UIMenu(children: actions)
    }
}

#Preview {
    HomeView()
        .environment(DataStore(service: DataService(auth: AuthService())))
}
