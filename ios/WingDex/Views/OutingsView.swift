import SwiftUI

struct OutingsView: View {
    var body: some View {
        NavigationStack {
            List {
                // TODO: Outing rows with chronological sort
                Text("No outings yet")
                    .foregroundStyle(.secondary)
            }
            .navigationTitle("Outings")
            // TODO: .searchable, sort/filter toolbar
        }
    }
}

#Preview {
    OutingsView()
}
