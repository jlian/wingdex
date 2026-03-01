import SwiftUI

struct HomeView: View {
    @Binding var showingAddPhotos: Bool

    var body: some View {
        NavigationStack {
            List {
                // TODO: Species count stat card
                Section("Quick Stats") {
                    Text("Species count: --")
                    Text("Total outings: --")
                }

                // TODO: Recent outings list
                Section("Recent Outings") {
                    Text("No outings yet")
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("WingDex")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showingAddPhotos = true
                    } label: {
                        Label("Add Photos", systemImage: "plus.circle.fill")
                    }
                }
            }
            .refreshable {
                // TODO: Pull-to-refresh data
            }
        }
    }
}

#Preview {
    HomeView(showingAddPhotos: .constant(false))
}
