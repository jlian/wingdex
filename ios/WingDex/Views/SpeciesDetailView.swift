import SwiftUI

struct SpeciesDetailView: View {
    let speciesName: String

    var body: some View {
        List {
            // TODO: Wikimedia image header
            Section {
                Text(speciesName)
                    .font(.title2)
            }

            // TODO: First seen, last seen, total outings, total count
            Section("Stats") {
                Text("First seen: --")
                Text("Last seen: --")
                Text("Total outings: --")
                Text("Total count: --")
            }

            // TODO: Observation history
            Section("Sightings") {
                Text("No sightings recorded")
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle(speciesName)
    }
}

#Preview {
    NavigationStack {
        SpeciesDetailView(speciesName: "Northern Cardinal")
    }
}
