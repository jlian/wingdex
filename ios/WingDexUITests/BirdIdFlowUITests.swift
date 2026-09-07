import XCTest

/// Native navigation, gestures and lifecycle only. Location state/races and real
/// inference are exercised directly in the unit targets without relaunching UI.
@MainActor
final class BirdIdFlowUITests: BirdIdFlowUITestCase {
    func testMissingGPSRequestsLocationOnlyAfterTap() {
        let app = launchApp(photoGPS: false, extraArguments: [
            "--ui-test-current-location-success", "--ui-test-geocoding-success",
            "--ui-test-disable-geo-context",
        ])
        _ = waitForOutingReview(in: app)
        let location = app.buttons["outing.adjustLocation"]
        XCTAssertEqual(locationValue(location), "")
        XCTAssertFalse(app.alerts.firstMatch.exists)
        XCTAssertFalse(app.buttons["outing.useCurrentLocation"].exists)
        openLocationPicker(in: app)
        let current = app.buttons["outing.useCurrentLocation"]
        XCTAssertTrue(current.existsOrWait(timeout: 5))
        XCTAssertFalse(app.staticTexts["Getting current location..."].exists)
        current.tap()
        XCTAssertTrue(location.labelOrWait("Carkeek Park", timeout: 5))
        XCTAssertEqual(app.staticTexts["outing.gpsStatus"].label, "Current location")
        XCTAssertEqual(app.staticTexts["outing.gpsCoordinates"].label, "(47.7115, -122.3717)")
    }

    func testDeniedLocationAllowsManualEntryAtAccessibilityTextSize() {
        let app = launchApp(photoGPS: false, extraArguments: [
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityL",
            "--ui-test-current-location-denied", "--ui-test-place-search-result",
            "--ui-test-stub-identification",
        ])
        let next = waitForOutingReview(in: app)
        openLocationPicker(in: app)
        let current = app.buttons["outing.useCurrentLocation"]
        XCTAssertTrue(scrollUntilVisible(current, in: app))
        current.tap()
        XCTAssertTrue(app.staticTexts["outing.currentLocationError"].existsOrWait(timeout: 5))
        setLocationQuery("Manual Park", in: app)
        let manual = app.buttons["outing.useEnteredName"]
        XCTAssertTrue(scrollUntilVisible(manual, in: app))
        manual.tap()
        XCTAssertTrue(app.searchFields.firstMatch.disappearsOrWait(timeout: 5))
        let location = app.buttons["outing.adjustLocation"]
        XCTAssertTrue(scrollUntilVisible(location, in: app))
        XCTAssertTrue(location.labelOrWait("Manual Park", timeout: 5))
        next.tap()
        XCTAssertTrue(app.staticTexts["confirm.speciesName"].existsOrWait(timeout: 10))
    }

    func testSessionlessPhotoReachesSpeciesConfirmation() {
        let app = launchApp(autoSignIn: false, extraArguments: [
            "--ui-test-geocoding-success", "--ui-test-stub-identification",
        ])
        let next = waitForOutingReview(in: app)
        XCTAssertEqual(locationValue(in: app), "Carkeek Park")
        next.tap()
        let species = app.staticTexts["confirm.speciesName"]
        XCTAssertTrue(species.existsOrWait(timeout: 10))
        XCTAssertEqual(species.label, Self.expectedSpecies)
        XCTAssertTrue(app.staticTexts["confirm.confidence"].label.hasSuffix("%"))
        XCTAssertTrue(app.buttons["confirm.accept"].isEnabled)
    }

    func testLowConfidenceIdentificationOffersInteractiveCropZoom() {
        let app = launchApp(extraArguments: [
            "--ui-test-geocoding-success", "--ui-test-stub-low-confidence-identification",
        ])
        waitForOutingReview(in: app).tap()
        let viewport = app.scrollViews["crop.viewport"]
        let target = app.descendants(matching: .any)["crop.offCenterPinchTarget"]
        XCTAssertTrue(viewport.existsOrWait(timeout: 10))
        XCTAssertTrue(viewport.isHittable)
        let initial = zoom(viewport)
        let initialCenter = target.value as? String
        target.pinch(withScale: 1.5, velocity: 1)
        XCTAssertGreaterThan(zoom(viewport), initial)
        XCTAssertNotEqual(target.value as? String, initialCenter)
        let beforeZoomIn = zoom(viewport)
        app.buttons["crop.zoomIn"].tap()
        XCTAssertGreaterThan(zoom(viewport), beforeZoomIn)
        let beforeZoomOut = zoom(viewport)
        app.buttons["crop.zoomOut"].tap()
        XCTAssertLessThan(zoom(viewport), beforeZoomOut)
    }

    private func zoom(_ viewport: XCUIElement) -> Double {
        Double(viewport.value as? String ?? "") ?? .nan
    }

    func testColdShareIsConsumedAndInterruptedShareDoesNotReappear() {
        let app = application()
        app.launchArguments += [
            "--ui-test-sign-out", "--ui-test-share-store",
            "--ui-test-reset-share-store", "--ui-test-stage-share",
        ]
        app.launch()
        waitForDataSetup(in: app)
        XCTAssertTrue(app.buttons["outing.continue"].existsOrWait(timeout: 15))
        app.terminate()
        app.launchArguments = [
            "--ui-test-sign-out", "--ui-test-share-store", "--ui-test-observe-share-queue",
        ]
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["ui-test.shareQueueChecked"].existsOrWait(timeout: 15))
        XCTAssertFalse(app.buttons["outing.continue"].exists)
    }

    func testAlreadyLoadedSessionlessAppReceivesStagedShare() {
        let app = application()
        app.launchArguments += [
            "--ui-test-sign-out", "--ui-test-share-store",
            "--ui-test-reset-share-store", "--ui-test-stage-share-after-launch",
        ]
        app.launch()
        waitForDataSetup(in: app)
        XCTAssertTrue(app.buttons["Home"].existsOrWait(timeout: 15))
        XCTAssertTrue(app.buttons["outing.continue"].existsOrWait(timeout: 15))
    }

    func testShareBootstrapFailureOffersRetryAndExplicitDiscard() {
        let app = application()
        app.launchArguments += [
            "--ui-test-sign-out", "--ui-test-auth-failure", "--ui-test-share-store",
            "--ui-test-reset-share-store", "--ui-test-stage-share",
        ]
        app.launch()
        waitForDataSetup(in: app)
        let alert = app.alerts["Could Not Continue"]
        XCTAssertTrue(alert.existsOrWait(timeout: 15), app.debugDescription)
        XCTAssertTrue(alert.buttons["Retry"].exists)
        alert.buttons["Close Upload"].tap()
        XCTAssertTrue(alert.disappearsOrWait(timeout: 5))
        app.terminate()
        app.launchArguments = [
            "--ui-test-sign-out", "--ui-test-share-store", "--ui-test-observe-share-queue",
        ]
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["ui-test.shareQueueChecked"].existsOrWait(timeout: 15))
        XCTAssertFalse(app.buttons["outing.continue"].exists)
    }
}
