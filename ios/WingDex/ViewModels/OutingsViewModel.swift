import Foundation
import Observation

/// ViewModel for OutingsView - fetch, create, delete outings.
@Observable
final class OutingsViewModel {
    var outings: [Outing] = []
    var isLoading = false
    var error: String?

    func loadOutings() async {
        // TODO: Fetch outings from /api/data/all
        isLoading = true
        // placeholder for async work
        isLoading = false
    }

    func deleteOuting(id: String) async {
        // TODO: DELETE /api/data/outings/{id}
    }
}
