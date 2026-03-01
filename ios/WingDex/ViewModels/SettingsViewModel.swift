import Foundation
import Observation

/// ViewModel for SettingsView - import/export, auth state, account management.
@Observable
final class SettingsViewModel {
    var linkedProviders: [String] = []
    var isImporting = false
    var isExporting = false
    var error: String?

    func loadLinkedProviders() async {
        // TODO: GET /api/auth/linked-providers
    }

    func importEbirdCSV(fileURL: URL) async {
        // TODO: POST /api/import/ebird-csv (multipart), then confirm flow
        isImporting = true
        // placeholder for async work
        isImporting = false
    }

    func exportSightings() async -> URL? {
        // TODO: GET /api/export/sightings, save to temp file, return URL for share sheet
        isExporting = true
        // placeholder for async work
        isExporting = false
        return nil
    }

    func exportDex() async -> URL? {
        // TODO: GET /api/export/dex, save to temp file, return URL for share sheet
        isExporting = true
        // placeholder for async work
        isExporting = false
        return nil
    }

    func clearAllData() async {
        // TODO: DELETE /api/data/clear
    }
}
