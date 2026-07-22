import AppIntents
import UniformTypeIdentifiers

struct GetSpeciesCountIntent: AppIntent {
    static let title: LocalizedStringResource = "Get Species Count"
    static let description = IntentDescription("Returns the number of species in your WingDex.")

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<Int> & ProvidesDialog {
        let data = try await IntentDataProvider().fetchAllData()
        let count = data.dex.count
        return .result(
            value: count,
            dialog: "You have seen \(count) species."
        )
    }
}

struct GetRecentSpeciesIntent: AppIntent {
    static let title: LocalizedStringResource = "Get Recent Species"
    static let description = IntentDescription("Returns up to five recently observed bird species.")

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<[String]> & ProvidesDialog {
        let data = try await IntentDataProvider().fetchAllData()
        let names = RecentSpeciesResolver.names(from: data)
        guard !names.isEmpty else { throw IntentDataError.noRecentSpecies }
        return .result(
            value: names,
            dialog: "Your recent species are \(names.joined(separator: ", "))."
        )
    }
}

struct GetLastSpeciesIntent: AppIntent {
    static let title: LocalizedStringResource = "Get Latest Outing Bird"
    static let description = IntentDescription("Returns a bird species from your latest outing.")

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        let data = try await IntentDataProvider().fetchAllData()
        guard let name = RecentSpeciesResolver.names(from: data, limit: 1).first else {
            throw IntentDataError.noRecentSpecies
        }
        return .result(value: name, dialog: "A bird from your latest outing was a \(name).")
    }
}

struct ExportSightingsIntent: AppIntent {
    static let title: LocalizedStringResource = "Export Sightings"
    static let description = IntentDescription("Exports your WingDex sightings as a CSV file.")

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<IntentFile> & ProvidesDialog {
        let data = try await IntentDataProvider().exportSightings()
        let file = IntentFile(
            data: data,
            filename: "wingdex-sightings.csv",
            type: .commaSeparatedText
        )
        return .result(value: file, dialog: "Your WingDex sightings are ready.")
    }
}