import SwiftUI

struct SettingsView: View {
    @Environment(AuthService.self) private var auth

    var body: some View {
        NavigationStack {
            Form {
                // TODO: Account section (avatar, name, linked providers)
                Section("Account") {
                    Text("Signed in")
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
                    Button("Manage Passkeys") {
                        // TODO: Passkey list/register
                    }
                }

                // TODO: Danger zone
                Section {
                    Button("Delete All Data", role: .destructive) {
                        // TODO: Confirmation dialog + clear API call
                    }
                    Button("Sign Out", role: .destructive) {
                        // TODO: Revoke token + clear state
                    }
                }
            }
            .navigationTitle("Settings")
        }
    }
}

#Preview {
    SettingsView()
        .environment(AuthService())
}
