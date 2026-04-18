import SwiftUI
import UniformTypeIdentifiers
import os

private let log = Logger(subsystem: Config.bundleID, category: "EBirdImport")

/// eBird CSV import flow with timezone picker, help section, and conflict display.
struct EBirdImportView: View {
    let auth: AuthService
    @Environment(DataStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    // MARK: - Timezone Presets

    private static let timezonePresets: [(value: String, region: String)] = [
        ("Pacific/Honolulu", "Hawaii"),
        ("America/Anchorage", "Alaska"),
        ("America/Los_Angeles", "Pacific"),
        ("America/Denver", "Mountain"),
        ("America/Chicago", "Central"),
        ("America/New_York", "Eastern"),
        ("America/Puerto_Rico", "Atlantic"),
        ("America/Sao_Paulo", "Brazil"),
        ("America/Argentina/Buenos_Aires", "Argentina"),
        ("America/Bogota", "Colombia"),
        ("America/Mexico_City", "Mexico"),
        ("Europe/London", "London"),
        ("Europe/Paris", "Central Europe"),
        ("Europe/Helsinki", "Eastern Europe"),
        ("Europe/Moscow", "Moscow"),
        ("Africa/Nairobi", "East Africa"),
        ("Africa/Lagos", "West Africa"),
        ("Africa/Johannesburg", "South Africa"),
        ("Asia/Dubai", "Gulf"),
        ("Asia/Kolkata", "India"),
        ("Asia/Bangkok", "Southeast Asia"),
        ("Asia/Shanghai", "China"),
        ("Asia/Taipei", "Taipei"),
        ("Asia/Tokyo", "Japan"),
        ("Asia/Seoul", "Korea"),
        ("Australia/Perth", "Western Australia"),
        ("Australia/Sydney", "Eastern Australia"),
        ("Pacific/Auckland", "New Zealand"),
    ]

    // MARK: - State

    @State private var selectedTimezone: String = {
        let current = TimeZone.current.identifier
        let knownIds = EBirdImportView.timezonePresets.map(\.value)
        return knownIds.contains(current) ? current : "observation-local"
    }()
    @State private var showFilePicker = false
    @State private var showHelp = false
    @State private var isImporting = false
    @State private var importError: String?

    // Preview state
    @State private var previews: [DataService.ImportPreview] = []
    @State private var showPreview = false
    @State private var selectedPreviewIds: Set<String> = []

    private var timezoneOptions: [(value: String, label: String)] {
        let now = Date()
        return Self.timezonePresets.map { preset in
            let tz = TimeZone(identifier: preset.value) ?? .current
            let seconds = tz.secondsFromGMT(for: now)
            let hours = seconds / 3600
            let minutes = abs(seconds % 3600) / 60
            let offset = minutes > 0
                ? String(format: "UTC%+03d:%02d", hours, minutes)
                : String(format: "UTC%+d", hours)
            return (value: preset.value, label: "\(offset) - \(preset.region)")
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                // Timezone picker
                Section {
                    Picker("eBird Profile Timezone", selection: $selectedTimezone) {
                        ForEach(timezoneOptions, id: \.value) { option in
                            Text(option.label).tag(option.value)
                        }
                        Divider()
                        Text("None (times already local)").tag("observation-local")
                    }
                } header: {
                    Text("Timezone")
                } footer: {
                    Text("eBird records times in the timezone of the device that submitted the checklist - typically your phone's home timezone. If you only bird locally, choose \"None\". Otherwise, select your home timezone so WingDex can convert times to each observation's local time.")
                }

                // Help section
                Section {
                    DisclosureGroup("How to Export from eBird", isExpanded: $showHelp) {
                        VStack(alignment: .leading, spacing: 12) {
                            step(1, "Go to ebird.org/downloadMyData and sign in")
                            step(2, "Click Submit to request your data download")
                            step(3, "You will receive an email with a download link for your CSV file. Upload that file here.")
                            Text("WingDex will create outings grouped by date and location, with all your species as confirmed observations.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.top, 4)
                    }
                }

                // Import button
                Section {
                    Button {
                        showFilePicker = true
                    } label: {
                        Label("Choose CSV File", systemImage: "doc.badge.plus")
                    }
                    .disabled(isImporting)
                }

                // Import progress / error
                if isImporting {
                    Section {
                        HStack {
                            ProgressView()
                            Text("Importing...")
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                if let importError {
                    Section {
                        Text(importError)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }

                // Preview / conflict display
                if showPreview, !previews.isEmpty {
                    Section {
                        let duplicates = previews.filter { $0.conflict == "duplicate" }
                        let nonDuplicates = previews.filter { $0.conflict != "duplicate" }

                        if !duplicates.isEmpty {
                            Text("\(duplicates.count) duplicate\(duplicates.count == 1 ? "" : "s") will be skipped")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Text("\(nonDuplicates.count) observation\(nonDuplicates.count == 1 ? "" : "s") ready to import")
                            .font(.subheadline)
                            .fontWeight(.medium)

                        Button {
                            Task { await confirmImport() }
                        } label: {
                            Label("Confirm Import", systemImage: "checkmark.circle")
                        }
                        .disabled(selectedPreviewIds.isEmpty || isImporting)
                    } header: {
                        Text("Preview")
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color.pageBg.ignoresSafeArea())
            .navigationTitle("Import eBird CSV")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .fileImporter(
                isPresented: $showFilePicker,
                allowedContentTypes: [UTType.commaSeparatedText, UTType.plainText],
                allowsMultipleSelection: false
            ) { result in
                Task { await handleFileSelection(result) }
            }
        }
    }

    // MARK: - Helpers

    @ViewBuilder
    private func step(_ number: Int, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text("\(number).")
                .fontWeight(.medium)
                .foregroundStyle(.primary)
            Text(text)
                .foregroundStyle(.secondary)
        }
        .font(.subheadline)
    }

    // MARK: - Import Logic

    private func handleFileSelection(_ result: Result<[URL], Error>) async {
        importError = nil
        showPreview = false

        switch result {
        case .failure(let error):
            importError = error.localizedDescription
            return
        case .success(let urls):
            guard let fileURL = urls.first else { return }

            guard fileURL.startAccessingSecurityScopedResource() else {
                importError = "Cannot access the selected file"
                return
            }
            defer { fileURL.stopAccessingSecurityScopedResource() }

            do {
                let csvData = try Data(contentsOf: fileURL)
                isImporting = true

                let service = DataService(auth: auth)
                let timezone = selectedTimezone == "observation-local" ? nil : selectedTimezone
                let results = try await service.importEBirdCSVPreview(csvData, profileTimezone: timezone)

                previews = results
                selectedPreviewIds = Set(
                    results
                        .filter { $0.conflict != "duplicate" }
                        .map(\.previewId)
                )
                showPreview = true
                isImporting = false
            } catch {
                importError = "Failed to preview CSV: \(error.localizedDescription)"
                isImporting = false
            }
        }
    }

    private func confirmImport() async {
        guard !selectedPreviewIds.isEmpty else { return }
        isImporting = true
        importError = nil

        do {
            let service = DataService(auth: auth)
            let result = try await service.confirmImport(previewIds: Array(selectedPreviewIds))

            await store.loadAll()

            let message = "Imported eBird data across \(result.imported.outings) outing\(result.imported.outings == 1 ? "" : "s")"
                + (result.imported.newSpecies > 0 ? " (\(result.imported.newSpecies) new!)" : "")
            log.info("\(message)")

            dismiss()
        } catch {
            importError = "Import failed: \(error.localizedDescription)"
            isImporting = false
        }
    }
}

#if DEBUG
#Preview {
    EBirdImportView(auth: AuthService())
        .environment(previewStore())
}
#endif
