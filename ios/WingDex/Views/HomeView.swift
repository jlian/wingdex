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
            VStack(alignment: .leading, spacing: 24) {
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

                // Recent species - horizontal scroll
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
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Recent Outings")
                            .font(.system(size: 18, weight: .semibold, design: .serif))
                            .padding(.horizontal)

                        VStack(spacing: 0) {
                            ForEach(recentOutings) { outing in
                                NavigationLink(value: outing) {
                                    OutingRow(outing: outing, store: store)
                                        .padding(.horizontal)
                                        .padding(.vertical, 10)
                                }
                                .buttonStyle(.plain)

                                if outing.id != recentOutings.last?.id {
                                    Divider().padding(.leading, 60)
                                }
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

// MARK: - Subviews

private struct SpeciesCard: View {
    let entry: DexEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Group {
                if let url = entry.thumbnailUrl, let imageURL = URL(string: url) {
                    AsyncImage(url: imageURL) { phase in
                        switch phase {
                        case .success(let image):
                            image.resizable()
                                .scaledToFill()
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
            .frame(width: 120, height: 90)
            .clipped()

            Text(getDisplayName(entry.speciesName))
                .font(.system(size: 11, weight: .semibold, design: .serif))
                .foregroundStyle(Color.foregroundText)
                .lineLimit(1)
                .truncationMode(.tail)
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                .frame(width: 120, alignment: .leading)
        }
        .background(Color.cardBg)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Color.warmBorder, lineWidth: 0.5)
        )
    }

    private var thumbnailPlaceholder: some View {
        Rectangle()
            .fill(Color.warmBorder.opacity(0.2))
            .overlay {
                Image(systemName: "bird.fill")
                    .foregroundStyle(.tertiary)
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

        HStack(spacing: 12) {
            Image(systemName: "mappin.circle.fill")
                .font(.title2)
                .foregroundStyle(Color.accentColor)
                .frame(width: 36)

            VStack(alignment: .leading, spacing: 3) {
                Text(outing.locationName.isEmpty ? "Outing" : outing.locationName)
                    .font(.system(size: 14, weight: .semibold, design: .serif))
                    .lineLimit(1)

                Text("\(DateFormatting.formatDate(outing.startTime, style: .medium)) \u{00B7} \(speciesNames.count) species")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if !speciesNames.isEmpty {
                    Text(
                        speciesNames.prefix(4).map { getDisplayName($0) }.joined(separator: ", ")
                        + (speciesNames.count > 4 ? " +\(speciesNames.count - 4) more" : "")
                    )
                    .font(.caption)
                    .foregroundStyle(.tertiary)
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
