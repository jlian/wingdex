import SwiftUI

struct WingDexView: View {
    @State private var searchText = ""

    var body: some View {
        NavigationStack {
            List {
                // TODO: Species rows grouped alphabetically
                // TODO: AsyncImage for Wikimedia thumbnails
                Text("No species in your WingDex yet")
                    .foregroundStyle(.secondary)
            }
            .navigationTitle("WingDex")
            .searchable(text: $searchText, prompt: "Search species")
            // TODO: Sort options toolbar
        }
    }
}

#Preview {
    WingDexView()
}
