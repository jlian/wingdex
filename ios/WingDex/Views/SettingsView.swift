import SwiftUI

struct SettingsView: View {
    @Environment(AuthService.self) private var auth
    @Environment(DataStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    // MARK: - State

    @State private var showingDeleteConfirmation = false
    @State private var isLoadingDemo = false
    @State private var demoError: String?
    @State private var showingDemoConfirmation = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Account") {
                    if let name = auth.userName, !name.isEmpty {
                        LabeledContent("Name", value: name)
                    }
                    if let email = auth.userEmail, !email.isEmpty {
                        LabeledContent("Email", value: email)
                    }
                    if (auth.userName == nil || auth.userName?.isEmpty == true)
                        && (auth.userEmail == nil || auth.userEmail?.isEmpty == true) {
                        Label("Guest Account", systemImage: "person.crop.circle.badge.questionmark")
                            .foregroundStyle(.secondary)
                    }
                }

                // TODO: Saved locations
                Section("Saved Locations") {
                    Text("No saved locations")
                        .foregroundStyle(.secondary)
                }

                // TODO: Import/Export
                Section("Data") {
                    Button {
                        // TODO: File picker + import flow
                    } label: {
                        Label("Import eBird CSV", systemImage: "square.and.arrow.down")
                    }
                    Button {
                        // TODO: Export sightings CSV
                    } label: {
                        Label("Export Sightings", systemImage: "square.and.arrow.up")
                    }
                    Button {
                        // TODO: Export dex CSV
                    } label: {
                        Label("Export WingDex", systemImage: "square.and.arrow.up")
                    }
                }

                // TODO: Passkey management
                Section("Security") {
                    NavigationLink("Manage Passkeys") {
                        PasskeyManagementView()
                    }
                }

                Section {
                    Toggle(isOn: Binding(
                        get: { UserDefaults.standard.object(forKey: "useGeoContext") as? Bool ?? true },
                        set: { UserDefaults.standard.set($0, forKey: "useGeoContext") }
                    )) {
                        Text("Use Location and Time")
                    }
                    .tint(Color.accentColor)
                } header: {
                    Text("Bird Identification")
                } footer: {
                    Text("Sends photo location and month to the AI for more accurate species identification.")
                }

                #if DEBUG
                Section("Development") {
                    Button {
                        showingDemoConfirmation = true
                    } label: {
                        if isLoadingDemo {
                            ProgressView()
                        } else {
                            Label("Load Demo Data", systemImage: "sparkles")
                        }
                    }
                    .disabled(isLoadingDemo)
                    .confirmationDialog(
                        "Load Demo Data?",
                        isPresented: $showingDemoConfirmation,
                        titleVisibility: .visible
                    ) {
                        Button("Replace All Data", role: .destructive) {
                            isLoadingDemo = true
                            demoError = nil
                            Task {
                                do {
                                    try await store.loadDemoData()
                                } catch {
                                    demoError = error.localizedDescription
                                }
                                isLoadingDemo = false
                            }
                        }
                    } message: {
                        Text("This will replace all your current outings, observations, and WingDex entries with demo data. This cannot be undone.")
                    }

                    if let demoError {
                        Text(demoError)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }
                #endif

                Section {
                    Button("Delete All Data", role: .destructive) {
                        showingDeleteConfirmation = true
                    }
                    .confirmationDialog("Delete All Data?", isPresented: $showingDeleteConfirmation, titleVisibility: .visible) {
                        Button("Delete Everything", role: .destructive) {
                            Task {
                                try? await store.clearAll()
                            }
                        }
                    } message: {
                        Text("This will permanently delete all your outings, photos, and sightings. This cannot be undone.")
                    }

                    Button("Log Out", role: .destructive) {
                        auth.signOut()
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color.pageBg.ignoresSafeArea())
            .navigationTitle("Settings")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done", systemImage: "xmark") {
                        dismiss() 
                    }
                }
            }
        }
    }
}

#Preview {
    SettingsView()
        .environment(AuthService())
        .environment(previewStore())
}
