import Foundation
import Observation

/// ViewModel for WingDexView - species life list with search and sort.
@Observable
final class WingDexViewModel {
    var dexEntries: [DexEntry] = []
    var filteredEntries: [DexEntry] = []
    var searchText = ""
    var isLoading = false
    var error: String?

    func loadDex() async {
        // TODO: Fetch from /api/data/dex
        isLoading = true
        // placeholder for async work
        isLoading = false
    }

    func filterEntries() {
        // TODO: Filter dexEntries by searchText
        if searchText.isEmpty {
            filteredEntries = dexEntries
        } else {
            filteredEntries = dexEntries.filter {
                $0.speciesName.localizedCaseInsensitiveContains(searchText)
            }
        }
    }
}
