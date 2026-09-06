import SwiftUI

struct OutingRenameSheet: View {
    let outing: Outing
    @Environment(DataStore.self) private var store
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var isSaving = false
    @State private var saveError: String?
    @FocusState private var isNameFocused: Bool

    init(outing: Outing) {
        self.outing = outing
        _name = State(initialValue: outing.locationName)
    }

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var suggestions: [String] {
        guard !trimmedName.isEmpty else { return [] }
        var seen = Set<String>()
        return store.outings
            .map { $0.locationName.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && seen.insert($0.lowercased()).inserted }
            .filter { $0.localizedCaseInsensitiveContains(trimmedName) && $0.caseInsensitiveCompare(name) != .orderedSame }
            .sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
            .prefix(8)
            .map { $0 }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Outing name", text: $name)
                        .focused($isNameFocused)
                        .submitLabel(.done)
                        .onSubmit { isNameFocused = false }
                        .disabled(isSaving)
                        .accessibilityIdentifier("outing.renameField")
                } footer: {
                    Text("Leave blank to restore the original location name.")
                }
                if !suggestions.isEmpty {
                    Section("Suggestions") {
                        ForEach(suggestions, id: \.self) { suggestion in
                            Button(suggestion) { name = suggestion }
                                .disabled(isSaving)
                        }
                    }
                }
                if let saveError {
                    Section {
                        Text(saveError)
                            .foregroundStyle(.red)
                            .accessibilityIdentifier("outing.renameError")
                    }
                }
            }
            .navigationTitle("Rename Outing")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel) { dismiss() }
                        .disabled(isSaving)
                        .accessibilityIdentifier("outing.renameCancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(isSaving || trimmedName == outing.locationName)
                        .accessibilityIdentifier("outing.renameSave")
                }
                if isSaving {
                    ToolbarItem(placement: .principal) { ProgressView("Saving…") }
                }
            }
            .defaultFocus($isNameFocused, true)
            .task {
                await Task.yield()
                isNameFocused = true
            }
        }
        .interactiveDismissDisabled(isSaving)
    }

    private func save() async {
        guard !isSaving else { return }
        isSaving = true
        saveError = nil
        defer { isSaving = false }
        let currentName = outing.locationName.trimmingCharacters(in: .whitespacesAndNewlines)
        let resetName = outing.defaultLocationName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let newName = trimmedName.isEmpty
            ? (resetName.isEmpty ? (currentName.isEmpty ? "Unknown Location" : currentName) : resetName)
            : trimmedName
        let defaultName = outing.defaultLocationName ?? (currentName.isEmpty ? nil : currentName)
        do {
            try await store.updateOuting(
                id: outing.id, fields: OutingUpdate(locationName: newName, defaultLocationName: defaultName)
            )
            toasts.show(trimmedName.isEmpty ? "Outing name reset" : "Outing name saved")
            dismiss()
        } catch {
            saveError = AppError.map(error, fallback: "Could not save outing name. Try again.")?.message
        }
    }
}
