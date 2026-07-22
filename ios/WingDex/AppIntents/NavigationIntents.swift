import AppIntents

struct UploadPhotosIntent: AppIntent {
    static let title: LocalizedStringResource = "Upload Bird Photos"
    static let description = IntentDescription("Opens WingDex to add and identify bird photos.")
    static let supportedModes: IntentModes = [.foreground(.immediate)]

    @MainActor
    func perform() async throws -> some IntentResult {
        AppNavigationModel.shared.route(to: .addPhotos(launchAction: .library))
        return .result()
    }
}

struct TakePhotoIntent: AppIntent {
    static let title: LocalizedStringResource = "Take Bird Photo"
    static let description = IntentDescription("Opens the WingDex camera to photograph and identify a bird.")
    static let supportedModes: IntentModes = [.foreground(.immediate)]

    @MainActor
    func perform() async throws -> some IntentResult {
        AppNavigationModel.shared.route(to: .addPhotos(launchAction: .camera))
        return .result()
    }
}

struct ViewWingDexIntent: AppIntent {
    static let title: LocalizedStringResource = "View WingDex"
    static let description = IntentDescription("Opens your WingDex, optionally filtered to a species.")
    static let supportedModes: IntentModes = [.foreground(.immediate)]

    @Parameter(title: "Species Filter")
    var speciesFilter: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Open WingDex for \(\.$speciesFilter)")
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        AppNavigationModel.shared.route(to: .wingdex(filter: speciesFilter))
        return .result()
    }
}

struct ViewOutingsIntent: AppIntent {
    static let title: LocalizedStringResource = "View Outings"
    static let description = IntentDescription("Opens your WingDex outings.")
    static let supportedModes: IntentModes = [.foreground(.immediate)]

    @MainActor
    func perform() async throws -> some IntentResult {
        AppNavigationModel.shared.route(to: .outings)
        return .result()
    }
}