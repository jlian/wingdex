import Foundation
import Observation

/// ViewModel for HomeView - recent outings and species count.
@Observable
final class HomeViewModel {
    var recentOutings: [Outing] = []
    var speciesCount: Int = 0
    var totalOutings: Int = 0
    var isLoading = false
    var error: String?

    func loadData() async {
        // TODO: Fetch from /api/data/all, populate recentOutings and stats
        isLoading = true
        // placeholder for async work
        isLoading = false
    }
}
