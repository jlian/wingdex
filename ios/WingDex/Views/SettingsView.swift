import SwiftUI

/// Local profile state that is decoupled from the global AuthService observable.
/// This prevents mutations here from triggering MainTabView re-renders (which
/// would reset the sheet). Changes sync back to AuthService on dismiss.
@MainActor @Observable
final class ProfileEditor {
    var name: String
    var image: String
    private let auth: AuthService
    private var pendingTask: Task<Void, Never>?

    /// Original social provider avatar, captured once for restore-on-deselect.
    let originalSocialImage: String

    init(auth: AuthService) {
        self.auth = auth
        self.name = auth.userName ?? ""
        self.image = auth.userImage ?? ""
        self.originalSocialImage = {
            let img = auth.userImage ?? ""
            return img.hasPrefix("data:image/svg+xml") ? "" : img
        }()
    }

    func save(name: String, image: String) {
        pendingTask?.cancel()
        self.name = name
        self.image = image
        pendingTask = Task {
            try? await auth.updateProfile(name: name, image: image)
        }
    }

    /// Push final state back to auth so the rest of the app sees it.
    func syncToAuth() {
        auth.userName = name
        auth.userImage = image
    }

    func isEmojiSelected(_ emoji: String) -> Bool {
        guard image.hasPrefix("data:image/svg+xml") else { return false }
        return (image.removingPercentEncoding ?? image).contains(emoji)
    }
}

struct SettingsView: View {
    @Environment(AuthService.self) private var auth
    @Environment(DataStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var editor: ProfileEditor?

    // Other state
    @State private var isLoadingDemo = false
    @State private var demoError: String?
    @State private var showingDemoConfirmation = false
    @State private var showingEBirdImport = false
    @State private var isExporting = false
    @State private var exportItem: ExportFileItem?
    @State private var isEditingName = false
    @State private var editedName = ""

    private var profile: ProfileEditor { editor! }

    var body: some View {
        NavigationStack {
            if editor != nil {
                formContent
            }
        }
        .onAppear {
            if editor == nil {
                editor = ProfileEditor(auth: auth)
            }
        }
        .onDisappear {
            editor?.syncToAuth()
        }
    }

    private var formContent: some View {
        Form {
            accountSection
            avatarSection
            importExportSection
            securitySection
            birdIdSection
            privacySection
            dataManagementSection

            #if DEBUG
            developmentSection
            #endif

            logOutSection
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
        .sheet(isPresented: $showingEBirdImport) {
            EBirdImportView(auth: auth)
        }
        .sheet(item: $exportItem) { item in
            ActivityView(activityItems: [item.url])
        }
    }

    // MARK: - Account

    @ViewBuilder
    private var accountSection: some View {
        Section("Account") {
            if !profile.name.isEmpty {
                HStack {
                    Text("Welcome,")
                        .foregroundStyle(.secondary)

                    Button {
                        let newName = FunNames.generateBirdName()
                        let emoji = FunNames.emojiForBirdName(newName)
                        profile.save(name: newName, image: FunNames.emojiAvatarDataUrl(emoji))
                    } label: {
                        Image(systemName: "arrow.clockwise")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)

                    Text(profile.name)
                        .fontWeight(.medium)
                        .foregroundStyle(.primary)

                    Button {
                        editedName = profile.name
                        isEditingName = true
                    } label: {
                        Image(systemName: "pencil")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                }
                .alert("Update Display Name", isPresented: $isEditingName) {
                    TextField("Display name", text: $editedName)
                    Button("Cancel", role: .cancel) {}
                    Button("Save") {
                        let trimmed = editedName.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !trimmed.isEmpty, trimmed != profile.name else { return }
                        profile.save(name: trimmed, image: profile.image)
                    }
                }
            } else {
                Label("Guest Account", systemImage: "person.crop.circle.badge.questionmark")
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - Avatar

    @ViewBuilder
    private var avatarSection: some View {
        if !profile.name.isEmpty {
            Section("Avatar") {
                HStack(spacing: 10) {
                    ForEach(FunNames.emojiOptions, id: \.self) { emoji in
                        let isSelected = profile.isEmojiSelected(emoji)
                        Button {
                            if isSelected {
                                profile.save(name: profile.name, image: profile.originalSocialImage)
                            } else {
                                profile.save(name: profile.name, image: FunNames.emojiAvatarDataUrl(emoji))
                            }
                        } label: {
                            Text(verbatim: emoji)
                                .font(.system(size: 24))
                                .frame(width: 36, height: 36)
                                .background(isSelected ? Color.accentColor.opacity(0.15) : Color.clear)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                                .overlay(
                                    isSelected
                                        ? RoundedRectangle(cornerRadius: 8).stroke(Color.accentColor, lineWidth: 2)
                                        : nil
                                )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.vertical, 2)
                .animation(.none, value: profile.image)
            }
        }
    }

    // MARK: - Import & Export

    @ViewBuilder
    private var importExportSection: some View {
        Section("Import & Export") {
            Button {
                showingEBirdImport = true
            } label: {
                Label("Import eBird CSV", systemImage: "square.and.arrow.down")
            }

            Button {
                Task { await exportSightings() }
            } label: {
                if isExporting {
                    HStack {
                        ProgressView()
                            .controlSize(.mini)
                        Text("Exporting...")
                    }
                } else {
                    Label("Export Sightings CSV", systemImage: "square.and.arrow.up")
                }
            }
            .disabled(store.dex.isEmpty || isExporting)
        }
    }

    // MARK: - Security

    @ViewBuilder
    private var securitySection: some View {
        Section("Security") {
            NavigationLink("Manage Passkeys") {
                PasskeyManagementView()
            }
        }
    }

    // MARK: - Bird Identification

    @ViewBuilder
    private var birdIdSection: some View {
        Section {
            Toggle(isOn: Binding(
                get: { UserDefaults.standard.object(forKey: "useGeoContext") as? Bool ?? true },
                set: { UserDefaults.standard.set($0, forKey: "useGeoContext") }
            )) {
                Text("Use Location and Time")
            }
        } header: {
            Text("Bird Identification")
        } footer: {
            Text("Sends photo location and month to the AI for more accurate species identification.")
        }
    }

    // MARK: - Legal

    @ViewBuilder
    private var privacySection: some View {
        Section("Legal") {
            Link(destination: URL(string: "\(Config.apiBaseURL.absoluteString)/privacy.html")!) {
                Label("Privacy Policy", systemImage: "hand.raised")
            }
            Link(destination: URL(string: "\(Config.apiBaseURL.absoluteString)/terms.html")!) {
                Label("Terms of Use", systemImage: "doc.text")
            }
        }
    }

    // MARK: - Data Management

    @ViewBuilder
    private var dataManagementSection: some View {
        Section("Data Management") {
            NavigationLink {
                DataManagementView()
            } label: {
                Label("Delete Data...", systemImage: "trash")
                    .foregroundStyle(.red)
            }
        }
    }

    // MARK: - Development (DEBUG only)

    #if DEBUG
    @ViewBuilder
    private var developmentSection: some View {
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
    }
    #endif

    // MARK: - Log Out

    @ViewBuilder
    private var logOutSection: some View {
        Section {
            Button("Log Out", role: .destructive) {
                auth.signOut()
            }
        }
    }

    // MARK: - Actions

    private func exportSightings() async {
        isExporting = true
        do {
            let service = DataService(auth: auth)
            let csvData = try await service.exportSightingsCSV()
            let dateStr = ISO8601DateFormatter().string(from: Date()).prefix(10)
            let fileName = "wingdex-sightings-\(dateStr).csv"
            let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
            try csvData.write(to: tempURL)
            exportItem = ExportFileItem(url: tempURL)
        } catch {
            // Could show an error, but export failures are rare
        }
        isExporting = false
    }
}

// MARK: - Export File Wrapper

/// Identifiable wrapper for the share sheet file URL.
struct ExportFileItem: Identifiable {
    let id = UUID()
    let url: URL
}

// MARK: - UIActivityViewController wrapper for share sheet

struct ActivityView: UIViewControllerRepresentable {
    let activityItems: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: activityItems, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

#Preview {
    SettingsView()
        .environment(AuthService())
        .environment(previewStore())
}
