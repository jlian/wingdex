import SwiftUI
import MapKit

struct OutingDetailView: View {
    let outingId: String
    @Environment(DataStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var showDeleteConfirm = false
    @State private var editingNotes = false
    @State private var notesText = ""
    @State private var contextMenuSpecies: String?

    private var outing: Outing? { store.outing(id: outingId) }
    private var confirmed: [BirdObservation] { store.confirmedObservations(outingId) }
    private var possible: [BirdObservation] { store.possibleObservations(outingId) }

    var body: some View {
        Group {
            if let outing {
                outingContent(outing)
            } else {
                ContentUnavailableView("Outing not found", systemImage: "exclamationmark.triangle")
            }
        }
        .navigationTitle(outing?.locationName ?? "Outing")
        .navigationBarTitleDisplayMode(.inline)
        .scrollContentBackground(.hidden)
        .background(Color.pageBg.ignoresSafeArea())
        .confirmationDialog("Delete this outing?", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button("Delete Outing", role: .destructive) {
                Task {
                    await store.deleteOuting(id: outingId)
                    dismiss()
                }
            }
        } message: {
            Text("This will permanently delete this outing and all its observations.")
        }
    }

    @ViewBuilder
    private func outingContent(_ outing: Outing) -> some View {
        List {
            // Header + stats
            Section {
                headerSection(outing)
                statsSection(outing)
                mapSection(outing)
            }
            .listRowSeparator(.hidden)

            // Confirmed species
            confirmedListSection

            // Possible species
            possibleListSection

            // Notes
            Section {
                notesSection(outing)
            }
            .listRowSeparator(.hidden)

            // Actions
            Section {
                Button(role: .destructive) {
                    showDeleteConfirm = true
                } label: {
                    Label("Delete Outing", systemImage: "trash")
                        .font(.system(size: 14))
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .navigationDestination(for: String.self) { speciesName in
            SpeciesDetailView(speciesName: speciesName)
        }
        .navigationDestination(item: $contextMenuSpecies) { speciesName in
            SpeciesDetailView(speciesName: speciesName)
        }
    }

    // MARK: - Header

    private func headerSection(_ outing: Outing) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(outing.locationName.isEmpty ? "Outing" : outing.locationName)
                .font(.system(.title2, design: .serif, weight: .bold))
                .foregroundStyle(Color.foregroundText)

            HStack(spacing: 4) {
                Image(systemName: "calendar")
                Text(DateFormatting.formatDate(outing.startTime, style: .medium))
                Text("\u{00B7}")
                Image(systemName: "clock")
                Text("\(DateFormatting.formatTime(outing.startTime))")
                if let dur = DateFormatting.duration(from: outing.startTime, to: outing.endTime) {
                    Text("(\(dur))")
                }
            }
            .font(.system(size: 13))
            .foregroundStyle(Color.mutedText)
        }
    }

    // MARK: - Stats

    private func statsSection(_ outing: Outing) -> some View {
        HStack(spacing: 0) {
            statCard(
                value: "\(Set(confirmed.map(\.speciesName)).count)",
                label: "Species",
                icon: "bird.fill"
            )
            Divider().frame(height: 40)
            statCard(
                value: "\(confirmed.count)",
                label: "Confirmed",
                icon: "checkmark.circle.fill"
            )
            Divider().frame(height: 40)
            statCard(
                value: "\(confirmed.reduce(0) { $0 + $1.count })",
                label: "Total",
                icon: "number"
            )
        }
        .padding(.vertical, 8)
        .background(Color.cardBg)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.warmBorder, lineWidth: 0.5))
    }

    private func statCard(value: String, label: String, icon: String) -> some View {
        VStack(spacing: 4) {
            Image(systemName: icon)
                .font(.caption)
                .foregroundStyle(Color.mutedText)
            Text(value)
                .font(.system(.title3, design: .serif, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(Color.accentColor)
            Text(label)
                .font(.caption2)
                .foregroundStyle(Color.mutedText)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Map

    @ViewBuilder
    private func mapSection(_ outing: Outing) -> some View {
        if let lat = outing.lat, let lon = outing.lon {
            let coordinate = CLLocationCoordinate2D(latitude: lat, longitude: lon)
            Button {
                openInMaps(for: outing, coordinate: coordinate)
            } label: {
                Map(initialPosition: .camera(.init(centerCoordinate: coordinate, distance: 3000))) {
                    Marker(outing.locationName, coordinate: coordinate)
                }
                .allowsHitTesting(false)
                .frame(height: 160)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(alignment: .topTrailing) {
                    Image(systemName: "arrow.up.right.square.fill")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(8)
                        .background(.black.opacity(0.45), in: Circle())
                        .padding(10)
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Open outing in Apple Maps")
        }
    }

    private func openInMaps(for outing: Outing, coordinate: CLLocationCoordinate2D) {
        let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        let mapItem = MKMapItem(location: location, address: nil)
        mapItem.name = outing.locationName.isEmpty ? "Outing" : outing.locationName
        mapItem.openInMaps(launchOptions: [
            MKLaunchOptionsMapCenterKey: NSValue(mkCoordinate: coordinate),
            MKLaunchOptionsMapSpanKey: NSValue(mkCoordinateSpan: MKCoordinateSpan(latitudeDelta: 0.05, longitudeDelta: 0.05)),
        ])
    }

    // MARK: - Confirmed

    @ViewBuilder
    private var confirmedListSection: some View {
        let grouped = Dictionary(grouping: confirmed, by: \.speciesName)
            .sorted { $0.key.localizedCaseInsensitiveCompare($1.key) == .orderedAscending }

        Section {
            if confirmed.isEmpty {
                Text("No confirmed observations")
                    .font(.system(size: 14))
                    .foregroundStyle(Color.mutedText)
            } else {
                ForEach(grouped, id: \.key) { speciesName, obs in
                    let totalCount = obs.reduce(0) { $0 + $1.count }
                    let entry = store.dexEntry(for: speciesName)
                    NavigationLink(value: speciesName) {
                        BirdRow(
                            speciesName: speciesName,
                            thumbnailUrl: entry?.thumbnailUrl,
                            count: totalCount
                        )
                    }
                    .contextMenu {
                        Button {
                            contextMenuSpecies = speciesName
                        } label: {
                            Label("View Species", systemImage: "bird")
                        }
                        Button {
                            UIPasteboard.general.string = speciesName
                        } label: {
                            Label("Copy Name", systemImage: "doc.on.doc")
                        }
                    } preview: {
                        NavigationStack {
                            SpeciesDetailView(speciesName: speciesName)
                        }
                        .environment(store)
                    }
                }
            }
        } header: {
            Text("Species (\(Set(confirmed.map(\.speciesName)).count))")
                .font(.system(size: 16, weight: .semibold, design: .serif))
                .foregroundStyle(Color.foregroundText)
        }
    }

    // MARK: - Possible

    @ViewBuilder
    private var possibleListSection: some View {
        if !possible.isEmpty {
            let grouped = Dictionary(grouping: possible, by: \.speciesName)
                .sorted { $0.key.localizedCaseInsensitiveCompare($1.key) == .orderedAscending }

            Section {
                ForEach(grouped, id: \.key) { speciesName, obs in
                    let totalCount = obs.reduce(0) { $0 + $1.count }
                    let entry = store.dexEntry(for: speciesName)
                    NavigationLink(value: speciesName) {
                        BirdRow(
                            speciesName: speciesName,
                            thumbnailUrl: entry?.thumbnailUrl,
                            count: totalCount
                        )
                    }
                    .contextMenu {
                        Button {
                            contextMenuSpecies = speciesName
                        } label: {
                            Label("View Species", systemImage: "bird")
                        }
                        Button {
                            UIPasteboard.general.string = speciesName
                        } label: {
                            Label("Copy Name", systemImage: "doc.on.doc")
                        }
                    } preview: {
                        NavigationStack {
                            SpeciesDetailView(speciesName: speciesName)
                        }
                        .environment(store)
                    }
                }
            } header: {
                Text("Possible (\(possible.count))")
                    .font(.system(size: 16, weight: .semibold, design: .serif))
                    .foregroundStyle(Color.foregroundText)
            }
        }
    }

    // MARK: - Notes

    private func notesSection(_ outing: Outing) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Notes")
                .font(.system(size: 16, weight: .semibold, design: .serif))
                .foregroundStyle(Color.foregroundText)

            if editingNotes {
                TextEditor(text: $notesText)
                    .frame(minHeight: 60)
                    .padding(8)
                    .background(Color.cardBg)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                HStack {
                    Button("Cancel") { editingNotes = false }
                    Spacer()
                    Button("Save") {
                        Task {
                            await store.updateOuting(id: outingId, fields: OutingUpdate(notes: notesText))
                            editingNotes = false
                        }
                    }
                    .fontWeight(.semibold)
                }
            } else {
                Text(outing.notes.isEmpty ? "No notes" : outing.notes)
                    .font(.system(size: 14))
                    .foregroundStyle(outing.notes.isEmpty ? Color.mutedText : Color.foregroundText)
                    .onTapGesture {
                        notesText = outing.notes
                        editingNotes = true
                    }
            }
        }
    }
}

#Preview("Outing Detail - Discovery Park") {
    NavigationStack {
        OutingDetailView(outingId: PreviewData.sampleOutingId)
            .environment(previewStore())
    }
}

#Preview("Outing Detail - Everglades") {
    NavigationStack {
        OutingDetailView(outingId: PreviewData.richOutingId)
            .environment(previewStore())
    }
}

#Preview("Outing Detail - Not Found") {
    NavigationStack {
        OutingDetailView(outingId: "nonexistent")
            .environment(previewStore())
    }
}
