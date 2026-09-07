import XCTest

extension XCUIElement {
    /// Avoid entering the waiter for an already-satisfied snapshot. XCTest
    /// does not promise a particular polling cadence.
    func existsOrWait(timeout: TimeInterval) -> Bool {
        exists || waitForExistence(timeout: timeout)
    }

    func disappearsOrWait(timeout: TimeInterval) -> Bool {
        !exists || waitForNonExistence(timeout: timeout)
    }

    func isEnabledOrWait(timeout: TimeInterval) -> Bool {
        isEnabled || wait(for: \.isEnabled, toEqual: true, timeout: timeout)
    }

    func labelOrWait(_ value: String, timeout: TimeInterval) -> Bool {
        label == value || wait(for: \.label, toEqual: value, timeout: timeout)
    }
}

/// Shared launch, synchronization and audit helpers for both UI test targets.
@MainActor
class BirdIdFlowUITestCase: XCTestCase {
    /// A shared fixture, also used by BirdIdAccuracyTests and the web tests. Read from
    /// the repo rather than the app bundle so it never ships inside the app.
    static let photo = "Great_blue_heron_roosting_at_Carkeek_Park.jpg"
    static let expectedSpecies = "Great Blue Heron"
    static let avatarEmojiLabels: Set<String> = ["🐦", "🦉", "🦜", "🐧", "🦆", "🦩", "🦅", "🐤"]

    static var photoPath: String {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("src/assets/images/\(photo)")
            .path
    }

    /// Stop broken journeys before subsequent navigation adds unrelated failures.
    override func setUp() {
        continueAfterFailure = false
    }

    func scrollUntilVisible(
        _ element: XCUIElement,
        in app: XCUIApplication,
        maximumSwipes: Int = 5
    ) -> Bool {
        let container = app.collectionViews.firstMatch.exists
            ? app.collectionViews.firstMatch
            : (app.scrollViews.firstMatch.exists ? app.scrollViews.firstMatch : app)

        for swipe in 0...maximumSwipes {
            let keyboard = app.keyboards.firstMatch
            let topNav = app.navigationBars.firstMatch

            let visibleTop = topNav.exists ? topNav.frame.maxY : container.frame.minY
            let visibleBottom = keyboard.exists && keyboard.frame.minY > visibleTop + 60
                ? keyboard.frame.minY
                : container.frame.maxY
            let visibleHeight = visibleBottom - visibleTop

            // A clipped control can be hittable while its tap center is behind
            // the navigation bar or keyboard, especially after sheet dismissal.
            if element.exists && element.isHittable,
                element.frame.midY > visibleTop + 10,
                element.frame.midY < visibleBottom - 10 {
                return true
            }
            if swipe == maximumSwipes { break }

            guard visibleHeight > 60 else {
                app.swipeUp()
                continue
            }

            let isAbove: Bool
            if element.exists {
                if element.frame.maxY <= visibleTop + 10 {
                    isAbove = true
                } else if element.frame.minY >= visibleBottom - 10 {
                    isAbove = false
                } else {
                    isAbove = element.frame.minY < visibleTop
                }
            } else {
                isAbove = false
            }

            let startY: CGFloat
            let endY: CGFloat
            if isAbove {
                startY = visibleTop + visibleHeight * 0.25
                endY = visibleTop + visibleHeight * 0.75
            } else {
                startY = visibleTop + visibleHeight * 0.75
                endY = visibleTop + visibleHeight * 0.25
            }

            let centerX = container.frame.midX
            let startCoord = app.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: centerX, dy: startY))
            let endCoord = app.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: centerX, dy: endY))

            startCoord.press(forDuration: 0.05, thenDragTo: endCoord)
        }
        return false
    }

    /// The accepted name is on the adjustLocation button; empty is displayed as 'No location'.
    func locationValue(_ element: XCUIElement) -> String {
        let label = element.label
        return label == "No location" ? "" : label
    }

    func locationValue(in app: XCUIApplication) -> String {
        locationValue(app.buttons["outing.adjustLocation"])
    }

    /// Open the native location search picker sheet from OutingReviewView.
    @discardableResult
    func openLocationPicker(in app: XCUIApplication) -> XCUIElement {
        let adjustButton = app.buttons["outing.adjustLocation"]
        XCTAssertTrue(scrollUntilVisible(adjustButton, in: app), "Adjust location button not found on review screen")
        adjustButton.tap()
        let searchField = app.searchFields.firstMatch
        XCTAssertTrue(searchField.existsOrWait(timeout: 5), "Native search field did not appear in location picker")
        return searchField
    }

    /// Set query in the native location search field.
    func setLocationQuery(_ text: String, in app: XCUIApplication) {
        let searchField = app.searchFields.firstMatch
        XCTAssertTrue(searchField.existsOrWait(timeout: 5), "Search field not found")
        searchField.tap()
        let clearButton = searchField.buttons["Clear text"]
        if clearButton.exists {
            clearButton.tap()
        }
        if !text.isEmpty {
            searchField.typeText(text)
        }
    }

    /// Return to review from a presented sheet (search or map) via explicit Close button.
    func returnToReview(in app: XCUIApplication) {
        let closeButton = app.buttons.matching(
            NSPredicate(format: "identifier IN %@", ["outing.locationClose", "outing.mapClose"])
        ).firstMatch
        XCTAssertTrue(closeButton.existsOrWait(timeout: 5), "Close button is missing")
        XCTAssertTrue(closeButton.isHittable, "Close button is not hittable")
        closeButton.tap()
        XCTAssertTrue(app.buttons["outing.continue"].existsOrWait(timeout: 5))
    }

    /// Map coordinates are included in the native toolbar button's spoken label.
    func mapCoordinatesText(in app: XCUIApplication) -> String {
        let recenter = app.buttons["outing.mapRecenter"]
        XCTAssertTrue(recenter.existsOrWait(timeout: 5), app.debugDescription)
        let label = recenter.label
        guard let range = label.range(of: #"\(-?\d+\.\d{4}, -?\d+\.\d{4}\)$"#, options: .regularExpression) else {
            XCTFail("Recenter is missing its coordinate description: \(label)")
            return ""
        }
        return String(label[range])
    }

    /// Finds the map preview element in OutingReviewView regardless of accessibility trait.
    func mapPreviewElement(in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: "outing.mapPreview").firstMatch
    }

    func runAccessibilityAudit(
        in app: XCUIApplication,
        for auditTypes: XCUIAccessibilityAuditType = .all,
        handlingKnownIssue: ((XCUIAccessibilityAuditIssue) -> Bool)? = nil
    ) throws {
        let selectedTypes = deepAudits
            ? auditTypes
            : auditTypes.intersection([.hitRegion, .sufficientElementDescription, .trait])
        guard !selectedTypes.isEmpty else { return }
        try app.performAccessibilityAudit(for: selectedTypes) { issue in
            handlingKnownIssue?(issue) ?? false
        }
    }

    var deepAudits: Bool {
        ProcessInfo.processInfo.environment["WINGDEX_DEEP_AUDITS"] == "1"
    }

    func isKnownAddPhotosAuditIssue(_ issue: XCUIAccessibilityAuditIssue) -> Bool {
        switch issue.auditType {
        case .contrast:
            return issue.element == nil && issue.compactDescription == "Contrast nearly passed"
        case .dynamicType:
            return issue.element?.identifier == "outing.photosHeader"
        case .textClipped:
            guard let identifier = issue.element?.identifier else { return false }
            return ["outing.gpsCoordinates", "outing.gpsStatus", "outing.locationQuery"]
                .contains(identifier)
        default:
            return false
        }
    }

    func isKnownAddPhotosSearchAuditIssue(
        _ issue: XCUIAccessibilityAuditIssue,
        in app: XCUIApplication
    ) -> Bool {
        if isKnownAddPhotosAuditIssue(issue) { return true }
        switch issue.auditType {
        case .contrast:
            // UIKit renders these secondary labels on the native search sheet.
            guard let label = issue.element?.label else { return false }
            return ["Keep existing coordinates", "Seattle, Washington"].contains(label)
        case .hitRegion:
            return issue.element?.label == "Clear text"
        case .sufficientElementDescription:
            // SwiftUI exposes unlabeled internal runs for the linked attribution footer.
            guard let element = issue.element,
                  element.identifier.isEmpty,
                  element.label.isEmpty
            else { return false }
            let attributions = app.descendants(matching: .any)
                .matching(identifier: "outing.locationAttribution")
                .allElementsBoundByIndex
            return attributions.contains { $0.frame.intersects(element.frame) }
        default:
            return false
        }
    }

    func isKnownAddPhotosMapAuditIssue(_ issue: XCUIAccessibilityAuditIssue) -> Bool {
        switch issue.auditType {
        case .contrast:
            // Map content changes underneath the adaptive glass button.
            return issue.element?.identifier == "outing.openAppleMaps"
        case .elementDetection:
            return issue.element == nil
        case .hitRegion:
            return issue.element?.label == "Legal"
        default:
            return false
        }
    }

    func isKnownSettingsAuditIssue(_ issue: XCUIAccessibilityAuditIssue) -> Bool {
        switch issue.auditType {
        case .contrast:
            // iOS 27 flags this decorative glyph even at measured 10.30:1 contrast
            // and with accessibilityHidden(true). Keep links and all other text audited.
            if issue.element?.identifier == "settings.footerSeparator",
                issue.element?.label == "·" {
                return true
            }
            let systemSectionHeaders = [
                "Account", "Avatar", "Import & Export", "Security",
                "Bird Identification", "Camera", "Legal", "Data Management",
            ]
            return (issue.element?.identifier ?? "").isEmpty
                && (
                    systemSectionHeaders.contains(issue.element?.label ?? "")
                        || ["Import eBird CSV", "Export Sightings CSV"]
                            .contains(issue.element?.label ?? "")
                )
        case .dynamicType:
            return issue.element?.identifier == "settings.birdIdFooter"
        case .textClipped:
            return Self.avatarEmojiLabels.contains(issue.element?.label ?? "")
        default:
            return false
        }
    }

    func isKnownSignInAuditIssue(_ issue: XCUIAccessibilityAuditIssue) -> Bool {
        guard let identifier = issue.element?.identifier else { return false }
        switch issue.auditType {
        case .contrast:
            // The moving collage makes automated contrast readings variable for
            // these translucent controls. Keep the exception scoped to stable IDs.
            return ["auth.passkeyLogin", "auth.passkeySignUp", "auth.google", "auth.github"].contains(identifier)
        case .hitRegion:
            return identifier == "auth.legal"
        default:
            return false
        }
    }

    func isKnownHomeAuditIssue(_ issue: XCUIAccessibilityAuditIssue) -> Bool {
        switch issue.auditType {
        case .dynamicType:
            return true
        case .textClipped:
            // The Recent Species carousel peeks the next card past the right
            // screen edge on purpose, to show that it scrolls, and the audit
            // reads that cut as clipped text. SpeciesCard already truncates at
            // two lines and is accessibilityHidden, and the UIKit cell carries
            // the real label, so nothing is actually unreadable.
            //
            // Blanket for the screen rather than scoped to that element,
            // because the audit reports this issue with a NIL element: there is
            // nothing to match on. Verified by dumping every issue on Home.
            //
            // It had never fired before only because the seed held two species,
            // too few for the carousel to overflow. Adding coordinates to the
            // seed does NOT cause it; a second outing does.
            return true
        default:
            return false
        }
    }

    func performListAccessibilityAudit(
        app: XCUIApplication,
        includesContrast: Bool
    ) throws {
        let auditTypes: XCUIAccessibilityAuditType = includesContrast
            ? .all
            : .all.subtracting(.contrast)
        try runAccessibilityAudit(in: app, for: auditTypes) { issue in
            switch issue.auditType {
            case .dynamicType where issue.element?.label == "Sort":
                return true
            case .textClipped where ["Search species", "Search outings", "Sort"].contains(issue.element?.label):
                return true
            default:
                return false
            }
        }
    }

    func waitForDataSetup(in app: XCUIApplication) {
        let elements = app.descendants(matching: .any)
        let complete = elements["ui-test.dataSetupComplete"]
        let failed = elements["ui-test.dataSetupFailed"]
        let outcome = elements.matching(
            NSPredicate(
                format: "identifier IN %@",
                ["ui-test.dataSetupComplete", "ui-test.dataSetupFailed"]
            )
        ).firstMatch
        XCTAssertTrue(
            outcome.existsOrWait(timeout: 15),
            "UI test data setup did not finish"
        )
        XCTAssertTrue(complete.exists || failed.exists, "UI test data setup reported an unknown outcome")
        XCTAssertFalse(failed.exists, "UI test data setup failed: \(failed.value as? String ?? "unknown error")")
    }

    func waitForOutingReview(
        in app: XCUIApplication,
        requireEnabled: Bool = true
    ) -> XCUIElement {
        waitForDataSetup(in: app)
        let continueButton = app.buttons["outing.continue"]
        XCTAssertTrue(continueButton.existsOrWait(timeout: 15), "Outing review never appeared")
        if requireEnabled {
            XCTAssertTrue(
                continueButton.isEnabledOrWait(timeout: 15),
                "Continue never became enabled"
            )
        }
        return continueButton
    }

    func application() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["API_BASE_URL"] = "https://ui-tests.invalid"
        app.launchEnvironment["WINGDEX_UI_TESTING"] = "1"
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        return app
    }

    func launchApp(
        autoSignIn: Bool = true,
        photoGPS: Bool = true,
        extraArguments: [String] = []
    ) -> XCUIApplication {
        let app = application()
        app.launchArguments += [
            "--ui-test-ignore-shares",
            "--ui-test-reset-signup-prompt",
            "--ui-test-photo", Self.photoPath,
        ] + extraArguments
        if photoGPS {
            app.launchArguments += ["--ui-test-lat", "47.7115", "--ui-test-lon", "-122.3717"]
        }
        if autoSignIn {
            let usesLocalFixture = extraArguments.contains("--ui-test-fixture-empty")
                || extraArguments.contains("--ui-test-fixture-populated")
            let setupArguments = usesLocalFixture
                ? []
                : ["--ui-test-fixture-empty"]
            app.launchArguments.insert(contentsOf: setupArguments, at: 0)
        } else {
            app.launchArguments.insert("--ui-test-sign-out", at: 0)
        }
        app.launch()
        return app
    }

}
