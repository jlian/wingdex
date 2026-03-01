import SwiftUI

struct ReviewView: View {
    var body: some View {
        List {
            // TODO: Per-photo AI identification results
            // TODO: Confirm/reject species, edit observations
            Section("AI Identifications") {
                Text("No identifications yet")
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Review")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Continue") {
                    // TODO: Navigate to ConfirmView
                }
            }
        }
    }
}

#Preview {
    NavigationStack {
        ReviewView()
    }
}
