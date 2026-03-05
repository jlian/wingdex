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
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                headerSection(outing)
                statsSection(outing)
                mapSection(outing)
                confirmedSection
                possibleSection
                notesSection(outing)
                actionsSection
            }
            .padding(.vertical)
        }
        .navigationDestination(for: String.self) { speciesName in
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
        .padding(.horizontal)
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
        .padding(.horizontal)
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
            VStack(alignment: .leading, spacing: 8) {
                let coordinate = CLLocationCoordinate2D(latitude: lat, longitude: lon)

                HStack(spacing: 4) {
                    Image(systemName: "mappin")
                        .foregroundStyle(Color.accentColor)
                    Text(outing.locationName)
                        .font(.system(size: 13))
                        .foregroundStyle(Color.mutedText)
                }
                .padding(.horizontal)

                Map(initialPosition: .camera(.init(centerCoordinate: coordinate, distance: 3000))) {
                    Marker(outing.locationName, coordinate: coordinate)
                }
                .frame(height: 160)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .padding(.horizontal)
            }
        }
    }

    // MARK: - Confirmed

    private var confirmedSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Species (\(Set(confirmed.map(\.speciesName)).count))")
                .font(.system(size: 16, weight: .semibold, design: .serif))
                .foregroundStyle(Color.foregroundText)
                .padding(.horizontal)
                .padding(.bottom, 8)

            if confirmed.isEmpty {
                Text("No confirmed observations")
                    .font(.system(size: 14))
                    .foregroundStyle(Color.mutedText)
                    .padding(.horizontal)
            } else {
                let grouped = Dictionary(grouping: confirmed, by: \.speciesName)
                    .sorted { $0.key.localizedCaseInsensitiveCompare($1.key) == .orderedAscending }
                ForEach(Array(grouped.enumerated()), id: \.element.key) { index, item in
                    let (speciesName, obs) = item
                    let totalCount = obs.reduce(0) { $0 + $1.count }
                    let entry = store.dexEntry(for: speciesName)
                    NavigationLink(value: speciesName) {
                        BirdRow(
                            speciesName: speciesName,
                            thumbnailUrl: entry?.thumbnailUrl,
                            count: totalCount
                        )
                        .padding(.horizontal)
                        .padding(.vertical, 10)
                    }
                    .buttonStyle(.scrollRow)
                    if index < grouped.count - 1 {
                        Divider().padding(.leading, 76)
                    }
                }
            }
        }
    }

    // MARK: - Possible

    @ViewBuilder
    private var possibleSection: some View {
        if !possible.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                Text("Possible (\(possible.count))")
                    .font(.system(size: 16, weight: .semibold, design: .serif))
                    .foregroundStyle(Color.foregroundText)
                    .padding(.horizontal)
                    .padding(.bottom, 8)

                let grouped = Dictionary(grouping: possible, by: \.speciesName)
                    .sorted { $0.key.localizedCaseInsensitiveCompare($1.key) == .orderedAscending }
                ForEach(Array(grouped.enumerated()), id: \.element.key) { index, item in
                    let (speciesName, obs) = item
                    let totalCount = obs.reduce(0) { $0 + $1.count }
                    let entry = store.dexEntry(for: speciesName)
                    NavigationLink(value: speciesName) {
                        BirdRow(
                            speciesName: speciesName,
                            thumbnailUrl: entry?.thumbnailUrl,
                            count: totalCount
                        )
                        .padding(.horizontal)
                        .padding(.vertical, 10)
                    }
                    .buttonStyle(.scrollRow)
                    if index < grouped.count - 1 {
                        Divider().padding(.leading, 76)
                    }
                }
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
        .padding(.horizontal)
    }

    // MARK: - Actions

    private var actionsSection: some View {
        VStack(spacing: 12) {
            Divider()
            Button(role: .destructive) {
                showDeleteConfirm = true
            } label: {
                Label("Delete Outing", systemImage: "trash")
                    .font(.system(size: 14))
            }
        }
        .padding(.horizontal)
        .padding(.top, 8)
    }
}

#Preview {
    NavigationStack {
        OutingDetailView(outingId: "preview-id")
            .environment(DataStore(service: DataService(auth: AuthService())))
    }
}
