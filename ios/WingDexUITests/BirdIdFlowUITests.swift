import XCTest

/// Native navigation, gestures and lifecycle only. Location state/races and real
/// inference are exercised directly in the unit targets without relaunching UI.
@MainActor
final class BirdIdFlowUITests: BirdIdFlowUITestCase {
    func testSpeciesReferenceLinksOpenExternallyAndPreserveReview() {
        let app = launchApp(autoSignIn: false, extraArguments: [
            "--ui-test-geocoding-success", "--ui-test-stub-identification",
        ])
        waitForOutingReview(in: app).tap()
        let learnMore = app.buttons["confirm.learnMore"]
        XCTAssertTrue(learnMore.existsOrWait(timeout: 10))
        learnMore.tap()

        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        let backgrounded = NSPredicate { _, _ in
            [.runningBackground, .runningBackgroundSuspended].contains(app.state)
        }
        for identifier in [
            "speciesPeek.reference.Wikipedia",
            "speciesPeek.reference.eBird",
            "speciesPeek.photoCredit",
        ] {
            let link = app.descendants(matching: .any).matching(identifier: identifier).firstMatch
            XCTAssertTrue(link.existsOrWait(timeout: 10), identifier)
            XCTAssertTrue(scrollUntilVisible(link, in: app), identifier)
            link.tap()
            XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 10), identifier)
            // iOS may suspend WingDex before Safari finishes becoming foreground.
            let background = XCTNSPredicateExpectation(predicate: backgrounded, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [background], timeout: 5), .completed,
                           "\(identifier): WingDex state \(app.state)")
            app.activate()
            XCTAssertTrue(app.buttons["Done"].existsOrWait(timeout: 5))
        }

        app.buttons["Done"].tap()
        XCTAssertTrue(learnMore.existsOrWait(timeout: 5))
        XCTAssertEqual(app.staticTexts["confirm.speciesName"].label, Self.expectedSpecies)
        XCTAssertTrue(app.buttons["confirm.accept"].isEnabled)
    }

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

        let idAttachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        idAttachment.name = "ID_Screen"
        idAttachment.lifetime = .keepAlways
        add(idAttachment)

        let possible = app.buttons["confirm.possible"]
        XCTAssertTrue(possible.existsOrWait(timeout: 5))
        possible.tap()

        let alert = app.alerts["Mark as Possible?"]
        XCTAssertTrue(alert.existsOrWait(timeout: 5))

        let possibleAttachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        possibleAttachment.name = "Possible_Confirmation"
        possibleAttachment.lifetime = .keepAlways
        add(possibleAttachment)

        alert.buttons["Cancel"].tap()
        XCTAssertTrue(alert.disappearsOrWait(timeout: 5))

        app.buttons["confirm.outingDetails"].tap()
        XCTAssertTrue(app.navigationBars["Outing Details"].existsOrWait(timeout: 5))
        let detailsAttachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        detailsAttachment.name = "Outing_Details"
        detailsAttachment.lifetime = .keepAlways
        add(detailsAttachment)
        let outingLocation = app.descendants(matching: .any)["confirm.outingLocation"]
        XCTAssertTrue(outingLocation.label.contains("Carkeek Park"), app.debugDescription)
        XCTAssertTrue(app.descendants(matching: .any)["confirm.outingDateTime"].exists)
        XCTAssertFalse(app.buttons["confirm.editOuting"].exists)
        app.buttons["confirm.outingDetailsDone"].tap()
        XCTAssertTrue(species.existsOrWait(timeout: 5))
        XCTAssertFalse(app.buttons["outing.continue"].exists)
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
        XCTAssertTrue(app.navigationBars["Crop to One Bird"].exists)
        XCTAssertTrue(app.navigationBars["Crop to One Bird"].buttons["crop.done"].exists)
        XCTAssertFalse(app.buttons["flow.close"].exists)
        XCTAssertFalse(app.buttons["crop.zoomIn"].exists)
        XCTAssertFalse(app.buttons["crop.zoomOut"].exists)
        XCTAssertFalse(app.buttons["Reset Crop"].exists)
        XCTAssertFalse(app.staticTexts["Crop to one bird."].exists)
        let cropAttachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        cropAttachment.name = "Crop_Screen"
        cropAttachment.lifetime = .keepAlways
        add(cropAttachment)
        app.buttons["crop.done"].tap()
        XCTAssertTrue(app.staticTexts["confirm.speciesName"].existsOrWait(timeout: 10))
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

    func testDiscardingIdentificationImmediatelyStartsQueuedShare() {
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
        let continueButton = app.buttons["outing.continue"]
        XCTAssertTrue(continueButton.existsOrWait(timeout: 15))
        XCTAssertTrue(continueButton.isEnabledOrWait(timeout: 15))
        continueButton.tap()
        XCTAssertTrue(app.staticTexts["confirm.speciesName"].existsOrWait(timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any)
            .matching(identifier: "ui-test.shareQueueDeferred").firstMatch.existsOrWait(timeout: 10))

        app.buttons["confirm.close"].tap()
        app.alerts["Discard progress?"].buttons["Discard"].tap()

        XCTAssertTrue(continueButton.existsOrWait(timeout: 15))
        XCTAssertEqual(locationValue(in: app), "")
        XCTAssertEqual(app.staticTexts["outing.photosHeader"].label, "Photos (1)")
        app.buttons["flow.close"].tap()
        app.alerts["Discard progress?"].buttons["Discard"].tap()
        XCTAssertTrue(app.descendants(matching: .any)
            .matching(identifier: "ui-test.shareQueueChecked").firstMatch.existsOrWait(timeout: 15))
        XCTAssertFalse(continueButton.exists)
    }
}
