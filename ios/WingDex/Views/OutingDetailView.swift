import SwiftUI
import MapKit

struct OutingDetailView: View {
    let outingId: String

    var body: some View {
        List {
            // TODO: Outing header with location, date range

            // TODO: MapKit location pin
            Section("Location") {
                Text("Map placeholder")
                    .frame(height: 200)
            }

            // TODO: Observation list with swipe-to-delete
            Section("Observations") {
                Text("No observations")
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Outing Detail")
    }
}

#Preview {
    NavigationStack {
        OutingDetailView(outingId: "preview-id")
    }
}
