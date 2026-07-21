#if DEBUG
import SwiftUI

private struct PreviewScreen<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        NavigationStack {
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.pageBg.ignoresSafeArea())
                .navigationTitle(title)
        }
    }
}

private struct RefreshErrorPreview: View {
    @State private var showError = true

    var body: some View {
        PreviewScreen(title: "WingDex") {
            List {
                Section("Recent Species") {
                    Label("Northern Cardinal", systemImage: "bird.fill")
                    Label("American Robin", systemImage: "bird.fill")
                }
            }
            .scrollContentBackground(.hidden)
        }
        .alert("Could Not Refresh", isPresented: $showError) {
            Button("Retry") {}
            Button("OK", role: .cancel) {}
        } message: {
            Text("You're offline. Check your connection and try again.")
        }
    }
}

private struct AddPhotosErrorPreview: View {
    @State private var showError = true

    var body: some View {
        PreviewScreen(title: "Identify Photo") {
            VStack(spacing: 16) {
                ProgressView()
                Text("Identifying bird...")
                    .foregroundStyle(.secondary)
            }
        }
        .alert("Could Not Continue", isPresented: $showError) {
            Button("Retry") {}
            Button("Close Upload", role: .destructive) {}
        } message: {
            Text("AI identification limit reached (150 requests/day). Try again later.")
        }
    }
}

private struct MutationErrorPreview: View {
    @State private var showError = true

    var body: some View {
        PreviewScreen(title: "Discovery Park") {
            List {
                Section("Outing") {
                    LabeledContent("Species", value: "12")
                    LabeledContent("Observations", value: "18")
                }
            }
            .scrollContentBackground(.hidden)
        }
        .alert("Could Not Complete Action", isPresented: $showError) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Could not save outing name. Try again.")
        }
    }
}

#Preview("Initial Load Failure") {
    PreviewScreen(title: "WingDex") {
        ContentUnavailableView {
            Label("Could Not Load WingDex", systemImage: "wifi.exclamationmark")
        } description: {
            Text("You're offline. Check your connection and try again.")
        } actions: {
            Button("Retry") {}
                .buttonStyle(.borderedProminent)
        }
    }
}

#Preview("Cached Refresh Failure") {
    RefreshErrorPreview()
}

#Preview("Add Photos Failure") {
    AddPhotosErrorPreview()
}

#Preview("Mutation Failure") {
    MutationErrorPreview()
}
#endif