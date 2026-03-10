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
    @State private var contextMenuOuting: Outing?

    var body: some View {
        NavigationStack {
            rootContent
                // WHY .frame + .background instead of ZStack: wrapping content in a ZStack
                // with Color.pageBg causes a white flash during push/pop transitions when
                // the nav bar collapses. Using .background() on the content directly avoids this.
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .background(Color.pageBg.ignoresSafeArea())
                .navigationTitle("Home")
                .toolbarTitleDisplayMode(.inlineLarge)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { showSettings() } label: {
                            AvatarView(imageURL: auth.userImage, name: auth.userName, size: 40)
                        }
                        // WHY negative padding: shifts the avatar closer to the trailing edge
                        // to match Apple Music's profile button position. Without this, the
                        // system toolbar inset leaves too much gap on the right.
                        .padding(.trailing, -12)
                    }
                    // WHY .sharedBackgroundVisibility(.hidden): removes the default liquid glass
                    // pill from behind the avatar button so it renders flat (like Apple Music's
                    // profile icon). HomeView has no sort button, so no explicit .glassEffect
                    // is needed here.
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
                .navigationDestination(item: $contextMenuOuting) { outing in
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
                                // WHY PeekPopContextMenu (UIKit) instead of SwiftUI .contextMenu:
                                // SwiftUI's .contextMenu on a ScrollView applies to the entire
                                // scroll container, not individual cards. There's no way to attach
                                // a per-card context menu + preview commit (tap-to-navigate) with
                                // pure SwiftUI. This UIKit wrapper gives each card its own
                                // UIContextMenuInteraction so long-press targets the right species
                                // and tapping the preview pushes to the detail view.
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
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .listSectionSeparator(.hidden, edges: .top)
    }

    private func speciesContextMenu(for entry: DexEntry) -> UIMenu {
        var actions: [UIMenuElement] = []

        actions.append(UIAction(title: "View Species", image: UIImage(systemName: "bird")) { _ in
            committedSpeciesEntry = entry
        })

        actions.append(UIAction(title: "Copy Name", image: UIImage(systemName: "doc.on.doc")) { _ in
            UIPasteboard.general.string = entry.speciesName
        })

        return UIMenu(children: actions)
    }
}

#if DEBUG
#Preview("Home - Populated") {
    HomeView()
        .environment(AuthService())
        .environment(previewStore())
}

#Preview("Home - Empty") {
    HomeView()
        .environment(AuthService())
        .environment(previewStore(empty: true))
}
#endif
