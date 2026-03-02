import SwiftUI

struct SettingsView: View {
    @Environment(AuthService.self) private var auth
    @State private var showingDeleteConfirmation = false
    @State private var showingSignOutConfirmation = false

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
                }

                // TODO: Saved locations
                Section("Saved Locations") {
                    Text("No saved locations")
                        .foregroundStyle(.secondary)
                }

                // TODO: Import/Export
                Section("Data") {
                    Button("Import eBird CSV") {
                        // TODO: File picker + import flow
                    }
                    Button("Export Sightings") {
                        // TODO: Export sightings CSV
                    }
                    Button("Export WingDex") {
                        // TODO: Export dex CSV
                    }
                }

                // TODO: Passkey management
                Section("Security") {
                    NavigationLink("Manage Passkeys") {
                        PasskeyManagementView()
                    }
                }

                Section {
                    Button("Delete All Data", role: .destructive) {
                        showingDeleteConfirmation = true
                    }
                    Button("Sign Out", role: .destructive) {
                        showingSignOutConfirmation = true
                    }
                }
            }
            .navigationTitle("Settings")
            .confirmationDialog("Delete All Data?", isPresented: $showingDeleteConfirmation, titleVisibility: .visible) {
                Button("Delete Everything", role: .destructive) {
                    // TODO: Call DELETE /api/data/clear then refresh
                }
            } message: {
                Text("This will permanently delete all your outings, photos, and sightings. This cannot be undone.")
            }
            .confirmationDialog("Sign Out?", isPresented: $showingSignOutConfirmation, titleVisibility: .visible) {
                Button("Sign Out", role: .destructive) {
                    auth.signOut()
                }
            }
        }
    }
}

#Preview {
    SettingsView()
        .environment(AuthService())
}
