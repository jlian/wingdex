import SwiftUI
import UIKit

struct HomeView: View {
    @Environment(AuthService.self) private var auth
    @Environment(DataStore.self) private var store
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.showAddPhotos) private var showAddPhotos
    @Environment(\.showWingDex) private var showWingDex
    @Environment(\.showOutings) private var showOutings
    @Environment(\.showSettings) private var showSettings
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            VStack(spacing: 0) {
                CachedDataNotice()
                rootContent
            }
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
                            AccountAvatarView(size: 40)
                        }
                        .accessibilityLabel(auth.isRegisteredAccount ? "Settings" : "Log in")
                        .accessibilityValue(
                            auth.identity == .anonymous && store.hasAccountDataAtRisk
                                ? "These sightings are only on this device"
                                : ""
                        )
                    }
                    .sharedBackgroundVisibility(.hidden)
                }
                .refreshable {
                    await store.loadAll()
                }
                .alert("Could Not Refresh", isPresented: cachedLoadErrorBinding) {
                    Button("Retry") { Task { await store.loadAll() } }
                    Button("OK", role: .cancel) { store.error = nil }
                } message: {
                    Text(store.error?.message ?? "Something went wrong. Try again.")
                }
                .navigationDestination(for: DexEntry.self) { entry in
                    SpeciesDetailView(speciesName: entry.speciesName, speciesKey: entry.id)
                }
                .navigationDestination(for: Outing.self) { outing in
                    OutingDetailView(outingId: outing.id)
                }
        }
    }

    private var cachedLoadErrorBinding: Binding<Bool> {
        Binding(
            get: { store.error != nil && !store.dex.isEmpty },
            set: { if !$0 { store.error = nil } }
        )
    }

    @ViewBuilder
    private var rootContent: some View {
        if store.isLoading && store.dex.isEmpty {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error = store.error, store.dex.isEmpty {
            ContentUnavailableView {
                Label("Could Not Load WingDex", systemImage: "wifi.exclamationmark")
            } description: {
                Text(error.message)
            } actions: {
                Button("Retry") { Task { await store.loadAll() } }
                    .buttonStyle(.borderedProminent)
            }
        } else if store.dex.isEmpty {
            emptyState
        } else {
            dataView
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        FoldAwareContent { availableSize in
            ScrollView {
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
                            .font(.system(.largeTitle, design: .serif, weight: .semibold))
                            .foregroundStyle(Color.foregroundText)
                            .fixedSize(horizontal: false, vertical: true)

                        Text("Add your photos, ID the birds, and build your WingDex.")
                            .font(.body)
                            .foregroundStyle(Color.mutedText)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Button {
                        showAddPhotos()
                    } label: {
                        Label {
                            Text("Identify Birds")
                                .font(.body.weight(.medium))
                                .fixedSize(horizontal: false, vertical: true)
                        } icon: {
                            Image(systemName: "camera.fill")
                                .font(.body)
                        }
                        .font(.body.weight(.medium))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .padding(.vertical, 10)
                    }
                    .buttonStyle(.glassProminent)
                    .buttonSizing(.flexible)
                    .tint(Color.accentColor)
                    .padding(.horizontal, 32)

                    Spacer()
                }
                .padding(24)
                .frame(maxWidth: 480)
                .frame(maxWidth: .infinity, minHeight: availableSize.height)
            }
            .scrollBounceBehavior(.basedOnSize)
            .accessibilityIdentifier("home.emptyContent")
        }
    }

    // MARK: - Data View

    private var dataView: some View {
        GeometryReader { geo in
            if AdaptiveLayout.prefersPairedPanes(
                in: geo, sizeClass: horizontalSizeClass, dynamicTypeSize: dynamicTypeSize
            ) {
                VStack(alignment: .leading, spacing: 16) {
                    speciesSummary.padding(.horizontal, 16)
                    AdaptiveColumns {
                        VStack(alignment: .leading, spacing: 12) {
                            sectionHeading("Recent Species", accessibilityLabel: "Open WingDex", action: showWingDex)
                                .padding(.horizontal, 16)
                            GeometryReader { pane in
                                recentSpeciesCarousel(
                                    cardSize: max(0, min((pane.size.width - 42) / 2, 200)),
                                    scrollDirection: .vertical
                                )
                            }
                        }
                    } secondary: {
                        if !store.recentOutings().isEmpty {
                            VStack(alignment: .leading, spacing: 12) {
                                sectionHeading("Recent Outings", accessibilityLabel: "Open Outings", action: showOutings)
                                    .padding(.horizontal, 16)
                                List { recentOutingRows }
                            }
                        }
                    }
                }
                .padding(.top, 16)
            } else {
                let visibleCards: CGFloat = dynamicTypeSize.isAccessibilitySize ? 1.1 : 2.25
                let cardSize = max(0, min(
                    (geo.size.width - 52) / visibleCards,
                    dynamicTypeSize.isAccessibilitySize ? 360 : 200
                ))
                List {
                    Section {
                        speciesSummary
                    }
                    .listRowSeparator(.hidden)

                    if !store.recentSpecies().isEmpty {
                        Section {
                            sectionHeading("Recent Species", accessibilityLabel: "Open WingDex", action: showWingDex)
                                .listRowSeparator(.hidden)
                            recentSpeciesCarousel(cardSize: cardSize)
                                .frame(height: cardSize)
                                .listRowInsets(EdgeInsets())
                                .listRowSeparator(.hidden)
                        }
                    }
                    recentOutingsSection
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .listSectionSeparator(.hidden, edges: .top)
    }

    private var speciesSummary: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("\(store.dex.count)")
                .font(.system(.largeTitle, design: .serif, weight: .semibold))
                .foregroundStyle(Color.foregroundText)
            Text("species observed")
                .font(.system(.title3, design: .serif))
                .italic()
                .foregroundStyle(Color.mutedText)
        }
    }

    private func recentSpeciesCarousel(
        cardSize: CGFloat,
        scrollDirection: UICollectionView.ScrollDirection = .horizontal
    ) -> some View {
        SpeciesCarousel(
            entries: store.recentSpecies(), auth: auth, store: store, toasts: toasts,
            cardSize: cardSize,
            menu: { speciesContextMenu(for: $0) },
            accessibilityActions: { speciesAccessibilityActions(for: $0) },
            onSelect: { path.append($0) },
            scrollDirection: scrollDirection
        )
    }

    private func sectionHeading(
        _ title: String, accessibilityLabel: String, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Text(title)
                    .font(.system(.title3, design: .serif, weight: .semibold))
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
            }
            .foregroundStyle(Color.foregroundText)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)
    }

    @ViewBuilder
    private var recentOutingsSection: some View {
        let recentOutings = store.recentOutings()
        if !recentOutings.isEmpty {
            Section {
                sectionHeading("Recent Outings", accessibilityLabel: "Open Outings", action: showOutings)
                    .listRowSeparator(.hidden)
                recentOutingRows
            }
        }
    }

    private var recentOutingRows: some View {
        ForEach(store.recentOutings()) { outing in
            NavigationLink(value: outing) {
                OutingRow(outing: outing, store: store)
            }
            .outingRowActions(
                outing: outing,
                onView: { path.append(outing) }
            )
        }
    }

    private func speciesContextMenu(for entry: DexEntry) -> UIMenu {
        var actions: [UIMenuElement] = []

        actions.append(UIAction(title: "View Details", image: UIImage(systemName: "bird")) { _ in
            path.append(entry)
        })

        actions.append(UIAction(title: "Share", image: UIImage(systemName: "square.and.arrow.up")) { _ in
            presentActivitySheet(items: [SharePayload.species(entry)])
        })

        if let url = getEbirdURL(forCode: entry.taxonCode) ?? getEbirdURL(for: entry.speciesName) {
            actions.append(UIAction(title: "Open in eBird", image: UIImage(systemName: "globe")) { _ in
                UIApplication.shared.open(url)
            })
        }

        if let url = getWikipediaURL(for: entry.wikiTitle) {
            actions.append(UIAction(title: "Open in Wikipedia", image: UIImage(systemName: "book")) { _ in
                UIApplication.shared.open(url)
            })
        }

        return UIMenu(children: actions)
    }

    private func speciesAccessibilityActions(
        for entry: DexEntry
    ) -> [ContextMenuAccessibilityAction] {
        var actions = [
            ContextMenuAccessibilityAction(name: "View Details") {
                path.append(entry)
            },
            ContextMenuAccessibilityAction(name: "Share") {
                presentActivitySheet(items: [SharePayload.species(entry)])
            },
        ]
        if let url = getEbirdURL(forCode: entry.taxonCode) ?? getEbirdURL(for: entry.speciesName) {
            actions.append(.init(name: "Open in eBird") { UIApplication.shared.open(url) })
        }
        if let url = getWikipediaURL(for: entry.wikiTitle) {
            actions.append(.init(name: "Open in Wikipedia") { UIApplication.shared.open(url) })
        }
        return actions
    }
}

#if DEBUG
#Preview("Home - Populated") {
    PreviewTabs(.home) { HomeView() }
        .environment(AuthService())
        .environment(previewStore())
}

#Preview("Home - Empty") {
    PreviewTabs(.home) { HomeView() }
        .environment(AuthService())
        .environment(previewStore(empty: true))
}

#endif
