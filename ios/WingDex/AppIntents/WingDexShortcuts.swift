import AppIntents

struct WingDexShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: ViewWingDexIntent(),
            phrases: [
                "Show my \(.applicationName)",
                "Open my \(.applicationName)",
            ],
            shortTitle: "Show WingDex",
            systemImageName: "bird"
        )
        AppShortcut(
            intent: UploadPhotosIntent(),
            phrases: [
                "Upload bird photos with \(.applicationName)",
                "Identify bird photos with \(.applicationName)",
            ],
            shortTitle: "Upload Photos",
            systemImageName: "photo.on.rectangle"
        )
        AppShortcut(
            intent: TakePhotoIntent(),
            phrases: [
                "Take a bird photo with \(.applicationName)",
                "Photograph a bird with \(.applicationName)",
            ],
            shortTitle: "Take Photo",
            systemImageName: "camera.fill"
        )
        AppShortcut(
            intent: ViewOutingsIntent(),
            phrases: [
                "Show my outings in \(.applicationName)",
                "Open my \(.applicationName) outings",
            ],
            shortTitle: "View Outings",
            systemImageName: "binoculars"
        )
        AppShortcut(
            intent: GetSpeciesCountIntent(),
            phrases: [
                "How many birds have I seen in \(.applicationName)",
                "How many species are in my \(.applicationName)",
            ],
            shortTitle: "Species Count",
            systemImageName: "number"
        )
        AppShortcut(
            intent: GetRecentSpeciesIntent(),
            phrases: [
                "Show my recent birds in \(.applicationName)",
                "What birds did I recently see in \(.applicationName)",
            ],
            shortTitle: "Recent Species",
            systemImageName: "clock.arrow.circlepath"
        )
        AppShortcut(
            intent: GetLastSpeciesIntent(),
            phrases: [
                "What was a bird from my latest \(.applicationName) outing",
                "Show a bird from my latest outing in \(.applicationName)",
            ],
            shortTitle: "Latest Outing Bird",
            systemImageName: "clock"
        )
        AppShortcut(
            intent: ExportSightingsIntent(),
            phrases: [
                "Export my sightings from \(.applicationName)",
                "Export my \(.applicationName) birds",
            ],
            shortTitle: "Export Sightings",
            systemImageName: "square.and.arrow.up"
        )
    }
}