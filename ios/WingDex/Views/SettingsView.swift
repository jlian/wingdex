import SwiftUI

struct SettingsView: View {
    @Environment(AuthService.self) private var auth
    @Environment(DataStore.self) private var store
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
                    Button("Delete All Data", role: .destructive) {
                        showingDeleteConfirmation = true
                    }
                    Button("Sign Out", role: .destructive) {
                        showingSignOutConfirmation = true
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color.pageBg.ignoresSafeArea())
            .navigationTitle("Settings")
            .confirmationDialog("Delete All Data?", isPresented: $showingDeleteConfirmation, titleVisibility: .visible) {
                Button("Delete Everything", role: .destructive) {
                    Task {
                        try? await store.clearAll()
                    }
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
    let auth = AuthService()
    SettingsView()
        .environment(auth)
        .environment(DataStore(service: DataService(auth: auth)))
}
