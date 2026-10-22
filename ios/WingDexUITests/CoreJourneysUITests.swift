import XCTest

@MainActor
final class CoreJourneysUITests: BirdIdFlowUITestCase {
    func testAddIdentifySaveAndFindSighting() throws {
        let app = launchApp(extraArguments: [
            "--ui-test-photo-on-add", "--ui-test-allow-photo-uploads",
            "--ui-test-geocoding-success", "--ui-test-stub-identification",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityL",
        ])
        XCTContext.runActivity(named: "Enter photo identification from empty Home") { _ in
            waitForDataSetup(in: app)
            let identify = app.buttons["Identify Birds"]
            XCTAssertTrue(scrollUntilVisible(identify, in: app))
            identify.tap()
            waitForOutingReview(in: app).tap()
        }
        XCTContext.runActivity(named: "Confirm and save the sighting") { _ in
            XCTAssertTrue(app.staticTexts["confirm.speciesName"].labelOrWait(Self.expectedSpecies, timeout: 10))
            app.buttons["confirm.accept"].tap()
            XCTAssertTrue(app.buttons["upload.done"].existsOrWait(timeout: 15), app.debugDescription)
            XCTAssertTrue(app.staticTexts["1 outing saved"].exists)
            app.buttons["upload.done"].tap()
            XCTAssertTrue(app.staticTexts["auth.accountDurability"].existsOrWait(timeout: 10))
            app.buttons["Close"].tap()
        }
        XCTContext.runActivity(named: "Find the saved outing and species in the main app") { _ in
            app.buttons["Outings"].tap()
            let outing = app.descendants(matching: .any).matching(
                NSPredicate(format: "label BEGINSWITH %@", "Carkeek Park")
            ).firstMatch
            XCTAssertTrue(outing.existsOrWait(timeout: 10), app.debugDescription)
            app.buttons["WingDex"].tap()
            let species = app.descendants(matching: .any).matching(
                NSPredicate(format: "label BEGINSWITH %@", Self.expectedSpecies)
            ).firstMatch
            XCTAssertTrue(species.existsOrWait(timeout: 10), app.debugDescription)
        }
        try performListAccessibilityAudit(app: app, includesContrast: false)
    }

    func testReviewPhotosAndCorrectLowConfidenceIdentification() throws {
        let secondPhoto = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("WingDex/Resources/CollagePhotos/collage1.jpg")
        let app = launchApp(extraArguments: [
            "--ui-test-geocoding-success", "--ui-test-stub-low-confidence-identification",
            "--ui-test-photo", secondPhoto.path,
        ])
        let next = waitForOutingReview(in: app)
        XCTContext.runActivity(named: "Browse the app-owned photo pager") { _ in
            let first = thumbnail(1, in: app)
            let secondID = thumbnail(2, in: app).identifier.replacingOccurrences(of: "outing.photo.", with: "")
            XCTAssertTrue(scrollUntilVisible(first, in: app))
            first.tap()
            XCTAssertTrue(app.navigationBars["Photo 1 of 2"].existsOrWait(timeout: 5))
            app.swipeLeft()
            let second = app.images["outing.photoPage.\(secondID)"]
            XCTAssertTrue(app.navigationBars["Photo 2 of 2"].existsOrWait(timeout: 5))
            XCTAssertTrue(second.isHittable || second.wait(for: \.isHittable, toEqual: true, timeout: 5))
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.6, dy: 0.5))
                .press(forDuration: 0.05, thenDragTo: app.coordinate(
                    withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)
                ), withVelocity: .slow, thenHoldForDuration: 0.2)
            XCTAssertTrue(app.navigationBars["Photo 2 of 2"].exists)
            app.buttons["outing.photosClose"].tap()
        }
        next.tap()
        let viewport = app.scrollViews["crop.viewport"]
        XCTAssertTrue(viewport.existsOrWait(timeout: 10))
        let initial = try XCTUnwrap(Double(viewport.value as? String ?? ""))
        viewport.pinch(withScale: 2, velocity: 1)
        if (Double(viewport.value as? String ?? "") ?? initial) <= initial {
            viewport.pinch(withScale: 2, velocity: 1)
        }
        XCTAssertGreaterThan(try XCTUnwrap(Double(viewport.value as? String ?? "")), initial)
        app.buttons["crop.done"].tap()
        XCTAssertTrue(app.staticTexts["confirm.speciesName"].labelOrWait(Self.expectedSpecies, timeout: 10))
    }

    func testBrowseSightingAndEditNotesWithoutLosingFocus() {
        let app = application()
        app.launchArguments += [
            "--ui-test-fixture-populated", "--ui-test-ignore-shares", "--ui-test-allow-outing-updates",
        ]
        app.launch()
        waitForDataSetup(in: app)
        let speciesName = "Chalk-browed Mockingbird"
        let outingName = "Parque Ibirapuera, Sao Paulo"
        let species = app.descendants(matching: .any).matching(
            NSPredicate(format: "label == %@", speciesName)
        ).firstMatch
        XCTAssertTrue(species.existsOrWait(timeout: 5))
        species.tap()
        let sighting = app.buttons["species.sighting.ui-test-seeded-outing"]
        XCTAssertTrue(scrollUntilVisible(sighting, in: app))
        sighting.tap()
        XCTAssertTrue(app.navigationBars[outingName].existsOrWait(timeout: 5))
        let notes = app.buttons["UI test seed"]
        XCTAssertTrue(scrollUntilVisible(notes, in: app))
        notes.tap()
        let editor = app.descendants(matching: .any).matching(identifier: "outing.notes").firstMatch
        XCTAssertTrue(app.keyboards.firstMatch.existsOrWait(timeout: 5))
        XCTAssertTrue(editor.existsOrWait(timeout: 5))
        editor.typeText(" journey")
        XCTAssertEqual(editor.value as? String, "UI test seed journey")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.buttons["UI test seed journey"].existsOrWait(timeout: 5))
        app.buttons["BackButton"].tap()
        XCTAssertTrue(app.navigationBars[speciesName].existsOrWait(timeout: 5))
        app.buttons["BackButton"].tap()
        XCTAssertTrue(app.navigationBars["Home"].existsOrWait(timeout: 5))
    }

    func testColdShareDoesNotReplayAfterInterruptedImport() {
        let app = application()
        app.launchArguments += [
            "--ui-test-sign-out", "--ui-test-share-store",
            "--ui-test-reset-share-store", "--ui-test-stage-share",
        ]
        app.launch()
        _ = waitForOutingReview(in: app, requireEnabled: false)
        app.terminate()
        app.launchArguments = [
            "--ui-test-sign-out", "--ui-test-share-store", "--ui-test-observe-share-queue",
        ]
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["ui-test.shareQueueChecked"].existsOrWait(timeout: 15))
        XCTAssertFalse(app.buttons["outing.continue"].exists)
    }

    func testDiscardingActiveIdentificationDeliversQueuedShare() {
        let app = application()
        app.launchArguments += [
            "--ui-test-fixture-empty", "--ui-test-share-store",
            "--ui-test-reset-share-store", "--ui-test-observe-share-queue",
            "--ui-test-stage-share-during-identification",
            "--ui-test-photo", Self.photoPath,
            "--ui-test-lat", "47.7115", "--ui-test-lon", "-122.3717",
            "--ui-test-geocoding-success", "--ui-test-stub-identification",
        ]
        app.launch()
        waitForOutingReview(in: app, requireDataSetup: false).tap()
        XCTAssertTrue(app.staticTexts["confirm.speciesName"].existsOrWait(timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any).matching(
            identifier: "ui-test.shareQueueDeferred"
        ).firstMatch.existsOrWait(timeout: 10))
        app.buttons["confirm.back"].tap()
        _ = waitForOutingReview(in: app, requireDataSetup: false)
        discardReview(in: app)
        _ = waitForOutingReview(in: app, requireDataSetup: false)
        XCTAssertEqual(locationValue(in: app), "")
        XCTAssertEqual(app.staticTexts["outing.photosHeader"].label, "Photos (1)")
        discardReview(in: app)
        XCTAssertTrue(app.descendants(matching: .any)["ui-test.shareQueueChecked"].existsOrWait(timeout: 15))
        XCTAssertFalse(app.buttons["outing.continue"].exists)
    }

    func testProfileControlsAndCameraPreferenceSurviveRelaunch() {
        let app = application()
        app.launchArguments += [
            "--ui-test-fixture-populated", "--ui-test-open-settings", "--ui-test-ignore-shares",
            "--ui-test-registered-blank-name",
        ]
        app.launch()
        waitForDataSetup(in: app)
        let name = app.textFields["settings.displayName"]
        XCTAssertTrue(name.existsOrWait(timeout: 10))
        XCTAssertEqual(name.value as? String, "bird@example.com")
        XCTAssertFalse(app.staticTexts["Guest Account"].exists)
        let setting = cameraSetting(in: app)
        let previous = setting.value as? String
        setting.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
        let updated = setting.value as? String
        XCTAssertNotEqual(updated, previous)
        XCTAssertFalse(app.alerts.firstMatch.exists)
        app.terminate()
        app.launch()
        waitForDataSetup(in: app)
        XCTAssertTrue(name.existsOrWait(timeout: 5))
        XCTAssertEqual(cameraSetting(in: app).value as? String, updated)
    }

    private func thumbnail(_ index: Int, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(
            format: "identifier BEGINSWITH %@ AND label == %@", "outing.photo.", "Photo \(index) of 2"
        )).firstMatch
    }

    private func discardReview(in app: XCUIApplication) {
        app.buttons["flow.close"].tap()
        app.alerts["Discard progress?"].buttons["Discard"].tap()
    }

    private func cameraSetting(in app: XCUIApplication) -> XCUIElement {
        let setting = app.switches["settings.saveCameraPhotos"]
        XCTAssertTrue(scrollUntilVisible(setting, in: app))
        return setting
    }
}
