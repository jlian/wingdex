import SwiftUI

struct ConfirmView: View {
    var body: some View {
        List {
            // TODO: Summary of outings to create
            Section("Outings") {
                Text("1 outing with 3 observations")
                    .foregroundStyle(.secondary)
            }

            // TODO: Final observation list with species, count, certainty
            Section("Observations") {
                Text("No observations to confirm")
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Confirm")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Save") {
                    // TODO: POST outings + observations to API, dismiss flow
                }
                .buttonStyle(.borderedProminent)
            }
        }
    }
}

#Preview {
    NavigationStack {
        ConfirmView()
    }
}
