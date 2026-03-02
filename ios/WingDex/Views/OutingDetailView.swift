import SwiftUI
import MapKit

struct OutingDetailView: View {
    let outingId: String
    @Environment(DataStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var showDeleteConfirm = false
    @State private var editingNotes = false
    @State private var notesText = ""

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
            headerSection(outing)
            statsSection(outing)
            mapSection(outing)
            confirmedSection
            possibleSection
            notesSection(outing)
            actionsSection
        }
    }

    // MARK: - Header

    private func headerSection(_ outing: Outing) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Text(outing.locationName.isEmpty ? "Outing" : outing.locationName)
                    .font(.system(.title2, design: .serif, weight: .bold))

                HStack(spacing: 4) {
                    Image(systemName: "calendar")
                    Text(DateFormatting.formatDate(outing.startTime, style: .medium))
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)

                HStack(spacing: 4) {
                    Image(systemName: "clock")
                    Text("\(DateFormatting.formatTime(outing.startTime)) - \(DateFormatting.formatTime(outing.endTime))")
                    if let dur = DateFormatting.duration(from: outing.startTime, to: outing.endTime) {
                        Text("(\(dur))")
                    }
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - Stats

    private func statsSection(_ outing: Outing) -> some View {
        Section {
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
        }
    }

    private func statCard(value: String, label: String, icon: String) -> some View {
        VStack(spacing: 4) {
            Image(systemName: icon)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.title3.bold().monospacedDigit())
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Map

    @ViewBuilder
    private func mapSection(_ outing: Outing) -> some View {
        if let lat = outing.lat, let lon = outing.lon {
            Section("Location") {
                let coordinate = CLLocationCoordinate2D(latitude: lat, longitude: lon)
                Map(initialPosition: .camera(.init(centerCoordinate: coordinate, distance: 3000))) {
                    Marker(outing.locationName, coordinate: coordinate)
                }
                .frame(height: 180)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            }
        }
    }

    // MARK: - Confirmed

    private var confirmedSection: some View {
        Section("Confirmed (\(confirmed.count))") {
            if confirmed.isEmpty {
                Text("No confirmed observations")
                    .foregroundStyle(.secondary)
            } else {
                let grouped = Dictionary(grouping: confirmed, by: \.speciesName)
                    .sorted { $0.key.localizedCaseInsensitiveCompare($1.key) == .orderedAscending }
                ForEach(grouped, id: \.key) { speciesName, obs in
                    let totalCount = obs.reduce(0) { $0 + $1.count }
                    observationRow(
                        speciesName: speciesName,
                        count: totalCount,
                        badge: nil,
                        observationIds: obs.map(\.id)
                    )
                }
            }
        }
    }

    // MARK: - Possible

    @ViewBuilder
    private var possibleSection: some View {
        if !possible.isEmpty {
            Section("Possible (\(possible.count))") {
                let grouped = Dictionary(grouping: possible, by: \.speciesName)
                    .sorted { $0.key.localizedCaseInsensitiveCompare($1.key) == .orderedAscending }
                ForEach(grouped, id: \.key) { speciesName, obs in
                    let totalCount = obs.reduce(0) { $0 + $1.count }
                    observationRow(
                        speciesName: speciesName,
                        count: totalCount,
                        badge: "possible",
                        observationIds: obs.map(\.id)
                    )
                }
            }
        }
    }

    private func observationRow(speciesName: String, count: Int, badge: String?, observationIds: [String]) -> some View {
        HStack {
            if let entry = store.dexEntry(for: speciesName),
               let url = entry.thumbnailUrl,
               let imageURL = URL(string: url) {
                AsyncImage(url: imageURL) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    default:
                        Image(systemName: "bird.fill")
                            .foregroundStyle(.tertiary)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .background(.quaternary)
                    }
                }
                .frame(width: 40, height: 40)
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }

            VStack(alignment: .leading) {
                Text(getDisplayName(speciesName))
                    .font(.subheadline.weight(.medium))
                HStack(spacing: 4) {
                    Text("x\(count)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let badge {
                        Text(badge)
                            .font(.caption2)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .background(.yellow.opacity(0.2))
                            .clipShape(Capsule())
                    }
                }
            }

            Spacer()
        }
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) {
                Task {
                    await store.rejectObservations(ids: observationIds)
                }
            } label: {
                Label("Remove", systemImage: "trash")
            }
        }
    }

    // MARK: - Notes

    private func notesSection(_ outing: Outing) -> some View {
        Section("Notes") {
            if editingNotes {
                TextEditor(text: $notesText)
                    .frame(minHeight: 60)
                HStack {
                    Button("Cancel") {
                        editingNotes = false
                    }
                    Spacer()
                    Button("Save") {
                        Task {
                            await store.updateOuting(id: outingId, fields: OutingUpdate(notes: notesText))
                            editingNotes = false
                        }
                    }
                    .bold()
                }
            } else {
                Text(outing.notes.isEmpty ? "No notes" : outing.notes)
                    .foregroundStyle(outing.notes.isEmpty ? .secondary : .primary)
                    .onTapGesture {
                        notesText = outing.notes
                        editingNotes = true
                    }
            }
        }
    }

    // MARK: - Actions

    private var actionsSection: some View {
        Section {
            Button(role: .destructive) {
                showDeleteConfirm = true
            } label: {
                Label("Delete Outing", systemImage: "trash")
            }
        }
    }
}

#Preview {
    NavigationStack {
        OutingDetailView(outingId: "preview-id")
            .environment(DataStore(service: DataService(auth: AuthService())))
    }
}
