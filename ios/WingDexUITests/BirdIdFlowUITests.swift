import XCTest

/// End-to-end cover for on-device identification. BirdIdAccuracyTests checks the
/// engine against a set of photos directly; this one checks that the add-photos
/// flow wires the engine up and renders the result it produces.
@MainActor
final class BirdIdFlowUITests: BirdIdFlowUITestCase {
    private func launchCurrentLocationReview(_ arguments: [String] = []) -> XCUIApplication {
        launchApp(photoGPS: false, extraArguments: [
            "--ui-test-fixture-populated",
            "--ui-test-last-location", "Unrelated Old Outing",
            "--ui-test-stub-identification",
        ] + arguments)
    }

    private func waitForLocation(_ value: String, in app: XCUIApplication) -> Bool {
        let predicate = NSPredicate(format: "label == %@ OR label BEGINSWITH %@", value, value)
        return app.buttons.matching(identifier: "outing.adjustLocation").matching(predicate).firstMatch.existsOrWait(timeout: 5)
    }

    private func captureLocationScreen(_ name: String, in app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func focusCurrentLocation(in app: XCUIApplication) -> XCUIElement {
        openLocationPicker(in: app)
        let button = app.buttons["outing.useCurrentLocation"]
        XCTAssertTrue(button.existsOrWait(timeout: 5), "Use current location button not found in picker")
        return button
    }

    func testMissingGPSStartsEmptyAndRequestsLocationOnlyAfterTap() {
        let app = launchCurrentLocationReview([
            "--ui-test-current-location-success", "--ui-test-geocoding-success",
            "--ui-test-disable-geo-context",
        ])
        _ = waitForOutingReview(in: app)
        let adjustLocation = app.buttons["outing.adjustLocation"]
        XCTAssertEqual(locationValue(adjustLocation), "")
        XCTAssertTrue((adjustLocation.value as? String ?? "").contains("No GPS data in photos"))
        XCTAssertFalse(app.staticTexts["outing.locationName"].exists)
        let initialGPSStatus = app.staticTexts["outing.gpsStatus"]
        XCTAssertTrue(initialGPSStatus.exists)
        XCTAssertTrue(initialGPSStatus.label.contains("No GPS data in photos"))
        XCTAssertFalse(app.descendants(matching: .any)["outing.gpsCoordinates"].exists)
        XCTAssertFalse(app.alerts.firstMatch.exists)
        XCTAssertFalse(app.buttons["outing.useCurrentLocation"].exists)
        captureLocationScreen("Missing GPS", in: app)
        let currentLocation = focusCurrentLocation(in: app)
        XCTAssertTrue(app.searchFields.firstMatch.existsOrWait(timeout: 5))
        XCTAssertFalse(app.staticTexts["Getting current location..."].exists)
        XCTAssertFalse(app.alerts.firstMatch.exists)
        captureLocationScreen("Focused missing GPS", in: app)
        currentLocation.tap()
        XCTAssertTrue(waitForLocation("Carkeek Park", in: app))
        XCTAssertTrue((adjustLocation.value as? String ?? "").contains("Current location"))
        XCTAssertEqual(app.descendants(matching: .any)["outing.gpsStatus"].label, "Current location")
        XCTAssertEqual(app.descendants(matching: .any)["outing.gpsCoordinates"].label, "(47.7115, -122.3717)")
        XCTAssertFalse(app.buttons["outing.useCurrentLocation"].exists)
        let mapPreview = mapPreviewElement(in: app)
        XCTAssertTrue(mapPreview.existsOrWait(timeout: 5))
        mapPreview.tap()
        XCTAssertEqual(mapCoordinatesText(in: app), "(47.7115, -122.3717)")
        XCTAssertNotEqual(mapCoordinatesText(in: app), "(47.7120, -122.3720)")
        returnToReview(in: app)
        captureLocationScreen("Current location resolved", in: app)
    }

    func testCurrentLocationDenialKeepsManualEntryUsable() {
        let app = launchCurrentLocationReview([
            "--ui-test-current-location-denied", "--ui-test-place-search-result",
        ])
        let continueButton = waitForOutingReview(in: app)
        focusCurrentLocation(in: app).tap()
        XCTAssertTrue(app.staticTexts["outing.currentLocationError"].existsOrWait(timeout: 5))
        XCTAssertTrue(app.buttons["outing.useCurrentLocation"].exists)
        captureLocationScreen("Current location denied", in: app)
        let searchField = app.searchFields.firstMatch
        searchField.typeText("Manual Park")
        let manualButton = app.buttons["outing.useEnteredName"]
        XCTAssertTrue(scrollUntilVisible(manualButton, in: app))
        manualButton.tap()
        let adjustLocation = app.buttons["outing.adjustLocation"]
        XCTAssertEqual(locationValue(adjustLocation), "Manual Park")
        XCTAssertFalse(app.staticTexts["outing.locationName"].exists)
        XCTAssertTrue(continueButton.isEnabled)
        continueButton.tap()
        XCTAssertTrue(app.staticTexts["confirm.speciesName"].existsOrWait(timeout: 10))
    }

    func testCurrentLocationOptionTracksQueryWithoutRequestingLocation() {
        let app = launchCurrentLocationReview([
            "--ui-test-current-location-denied", "--ui-test-place-search-result",
        ])
        _ = waitForOutingReview(in: app)
        XCTAssertFalse(app.buttons["outing.useCurrentLocation"].exists)
        let searchField = openLocationPicker(in: app)
        XCTAssertFalse(app.staticTexts["outing.currentLocationError"].exists)
        XCTAssertFalse(app.alerts.firstMatch.exists)

        searchField.typeText("Manual name")
        XCTAssertFalse(app.buttons["outing.useCurrentLocation"].exists)
        returnToReview(in: app)
        XCTAssertFalse(app.buttons["outing.useCurrentLocation"].exists)
        XCTAssertFalse(app.staticTexts["outing.currentLocationError"].exists)
        let adjustLocation = app.buttons["outing.adjustLocation"]
        XCTAssertEqual(locationValue(adjustLocation), "")
        XCTAssertFalse(app.staticTexts["outing.locationName"].exists)
        XCTAssertFalse(app.staticTexts["outing.currentLocationError"].exists)
    }

    func testCurrentLocationRestoreAndNearbySelectionKeepDeviceCoordinates() {
        let app = launchCurrentLocationReview([
            "--ui-test-current-location-success", "--ui-test-geocoding-success",
            "--ui-test-place-search-result",
        ])
        _ = waitForOutingReview(in: app)
        focusCurrentLocation(in: app).tap()
        let adjustLocation = app.buttons["outing.adjustLocation"]
        XCTAssertTrue(waitForLocation("Carkeek Park", in: app))
        openLocationPicker(in: app)
        setLocationQuery("Discovery", in: app)
        app.searchFields.firstMatch.typeText("\n")
        let result = app.buttons.matching(identifier: "outing.locationResult").firstMatch
        XCTAssertTrue(result.existsOrWait(timeout: 5))
        result.tap()
        XCTAssertEqual(locationValue(adjustLocation), "Discovery Park")
        XCTAssertTrue((adjustLocation.value as? String ?? "").contains("Location set from search"))
        openLocationPicker(in: app)
        let restore = app.buttons["outing.locationRestore"]
        XCTAssertTrue(restore.label.hasPrefix("Use current location:"))
        restore.tap()
        XCTAssertEqual(locationValue(adjustLocation), "Carkeek Park")
        let restoreMapPreview = mapPreviewElement(in: app)
        XCTAssertTrue(restoreMapPreview.existsOrWait(timeout: 5))
        restoreMapPreview.tap()
        XCTAssertEqual(mapCoordinatesText(in: app), "(47.7115, -122.3717)")
        returnToReview(in: app)
        openLocationPicker(in: app)
        let nearby = app.buttons.matching(identifier: "outing.locationNearbyResult").firstMatch
        XCTAssertTrue(nearby.existsOrWait(timeout: 5))
        nearby.tap()
        let nearbyMapPreview = mapPreviewElement(in: app)
        XCTAssertTrue(nearbyMapPreview.existsOrWait(timeout: 5))
        nearbyMapPreview.tap()
        XCTAssertEqual(mapCoordinatesText(in: app), "(47.7115, -122.3717)")
        returnToReview(in: app)
        openLocationPicker(in: app)
        setLocationQuery("My Birding Spot", in: app)
        let manual = app.buttons["outing.useEnteredName"]
        XCTAssertTrue(scrollUntilVisible(manual, in: app))
        manual.tap()
        XCTAssertEqual(locationValue(adjustLocation), "My Birding Spot")
        let manualMapPreview = mapPreviewElement(in: app)
        XCTAssertTrue(manualMapPreview.existsOrWait(timeout: 5))
        manualMapPreview.tap()
        XCTAssertEqual(mapCoordinatesText(in: app), "(47.7115, -122.3717)")
        returnToReview(in: app)
        XCTAssertTrue((adjustLocation.value as? String ?? "").contains("Current location"))
        XCTAssertFalse(app.staticTexts["outing.locationName"].exists)
        XCTAssertEqual(app.descendants(matching: .any)["outing.gpsStatus"].label, "Current location")
        XCTAssertEqual(app.descendants(matching: .any)["outing.gpsCoordinates"].label, "(47.7115, -122.3717)")
    }

    func testCurrentLocationEmptyAndErrorRetainCoordinatesWithoutOldName() {
        for outcome in ["empty", "failure"] {
            let app = launchCurrentLocationReview([
                "--ui-test-current-location-success", "--ui-test-geocoding-\(outcome)",
            ])
            _ = waitForOutingReview(in: app)
            focusCurrentLocation(in: app).tap()
            let adjustLocation = app.buttons["outing.adjustLocation"]
            XCTAssertTrue(waitForLocation("47.712\u{00B0}, -122.372\u{00B0}", in: app))
            let mapPreview = mapPreviewElement(in: app)
            XCTAssertTrue(mapPreview.existsOrWait(timeout: 5))
            mapPreview.tap()
            XCTAssertEqual(mapCoordinatesText(in: app), "(47.7115, -122.3717)")
            returnToReview(in: app)
            if outcome == "failure" {
                let retry = app.buttons["outing.locationRetry"]
                XCTAssertTrue(retry.existsOrWait(timeout: 5))
                XCTAssertTrue((adjustLocation.value as? String ?? "").contains("Location lookup failed"))
                retry.tap()
                XCTAssertTrue(retry.existsOrWait(timeout: 5))
                XCTAssertTrue((adjustLocation.value as? String ?? "").contains("Location lookup failed"))
                XCTAssertEqual(locationValue(adjustLocation), "47.712\u{00B0}, -122.372\u{00B0}")
                let retryMapPreview = mapPreviewElement(in: app)
                XCTAssertTrue(retryMapPreview.existsOrWait(timeout: 5))
                retryMapPreview.tap()
                XCTAssertEqual(mapCoordinatesText(in: app), "(47.7115, -122.3717)")
                returnToReview(in: app)
            } else {
                XCTAssertTrue((adjustLocation.value as? String ?? "").contains("No named place found nearby"))
                XCTAssertFalse(app.staticTexts["outing.locationLookupEmpty"].exists)
                XCTAssertFalse(app.buttons["outing.locationRetry"].exists)
            }
            XCTAssertFalse(app.staticTexts["outing.locationName"].exists)
            app.terminate()
        }
    }

    func testManualEntryCancelsCurrentLocationAndReverseLookup() {
        for delay in ["--ui-test-current-location-delay", "--ui-test-geocoding-delay"] {
            let app = launchCurrentLocationReview([
                "--ui-test-current-location-success", "--ui-test-geocoding-success", delay,
                "--ui-test-place-search-result",
            ])
            _ = waitForOutingReview(in: app)
            focusCurrentLocation(in: app).tap()
            XCTAssertTrue(app.buttons["outing.currentLocationCancel"].existsOrWait(timeout: 5))
            setLocationQuery("Manual Park", in: app)
            let manualButton = app.buttons["outing.useEnteredName"]
            XCTAssertTrue(scrollUntilVisible(manualButton, in: app))
            manualButton.tap()
            let adjustLocation = app.buttons["outing.adjustLocation"]
            XCTAssertEqual(locationValue(adjustLocation), "Manual Park")
            XCTAssertFalse(mapPreviewElement(in: app).exists)
            XCTAssertFalse(app.buttons["outing.locationCancel"].exists)
            XCTAssertTrue(app.buttons["outing.continue"].isEnabled)
            let overwritten = NSPredicate { _, _ in
                self.locationValue(adjustLocation) != "Manual Park"
            }
            let remainsManual = XCTNSPredicateExpectation(predicate: overwritten, object: nil)
            remainsManual.isInverted = true
            wait(for: [remainsManual], timeout: 11)
            app.terminate()
        }
    }

    func testMatchedOutingInheritsInsteadOfOfferingCurrentLocation() {
        let app = launchCurrentLocationReview(["--ui-test-match-outing"])
        _ = waitForOutingReview(in: app)
        XCTAssertTrue(app.descendants(matching: .any)["outing.inheritedLocationName"].exists)
        XCTAssertFalse(app.buttons["outing.adjustLocation"].exists)
        XCTAssertFalse(app.buttons["outing.useCurrentLocation"].exists)
        let mapPreview = mapPreviewElement(in: app)
        XCTAssertTrue(mapPreview.existsOrWait(timeout: 5))
        mapPreview.tap()
        XCTAssertEqual(mapCoordinatesText(in: app), "(-23.5875, -46.6575)")
        returnToReview(in: app)
        startNewOuting(in: app)
        XCTAssertFalse(app.buttons["outing.useCurrentLocation"].exists)
        let adjustLocation = app.buttons["outing.adjustLocation"]
        XCTAssertEqual(locationValue(adjustLocation), "")
        XCTAssertFalse(app.staticTexts["outing.locationName"].exists)
        openLocationPicker(in: app)
        XCTAssertTrue(app.buttons["outing.useCurrentLocation"].existsOrWait(timeout: 5))
        returnToReview(in: app)
    }

    func testGPSLookupFailureDoesNotReuseLastConfirmedName() {
        let app = launchApp(extraArguments: [
            "--ui-test-fixture-populated", "--ui-test-last-location", "Unrelated Old Outing",
            "--ui-test-geocoding-failure",
        ])
        _ = waitForOutingReview(in: app)
        let adjustLocation = app.buttons["outing.adjustLocation"]
        XCTAssertEqual(locationValue(adjustLocation), "47.712\u{00B0}, -122.372\u{00B0}")
        XCTAssertTrue((adjustLocation.value as? String ?? "").contains("Location lookup failed"))
        XCTAssertFalse(app.buttons["outing.useCurrentLocation"].exists)
        XCTAssertTrue(app.buttons["outing.locationRetry"].exists)
        XCTAssertFalse(app.staticTexts["outing.locationName"].exists)
        XCTAssertFalse(app.staticTexts["outing.locationLookupError"].exists)
    }

    func testCancelAndDismissCurrentLocationRequest() {
        let app = launchCurrentLocationReview([
            "--ui-test-current-location-success", "--ui-test-current-location-delay",
        ])
        _ = waitForOutingReview(in: app)
        focusCurrentLocation(in: app).tap()
        let cancel = app.buttons["outing.currentLocationCancel"]
        XCTAssertTrue(cancel.existsOrWait(timeout: 5))
        cancel.tap()
        XCTAssertTrue(app.buttons["outing.useCurrentLocation"].existsOrWait(timeout: 5))
        returnToReview(in: app)
        focusCurrentLocation(in: app).tap()
        returnToReview(in: app)
        XCTAssertFalse(mapPreviewElement(in: app).exists)
        app.buttons["Close"].tap()
        XCTAssertTrue(app.alerts["Discard progress?"].existsOrWait(timeout: 5))
        app.alerts["Discard progress?"].buttons["Discard"].tap()
        XCTAssertTrue(app.buttons["outing.useCurrentLocation"].disappearsOrWait(timeout: 5))
        XCTAssertFalse(app.alerts.firstMatch.exists)
    }

    func testNextClusterDoesNotInheritCurrentLocation() {
        let app = launchCurrentLocationReview([
            "--ui-test-current-location-success", "--ui-test-geocoding-success",
            "--ui-test-two-clusters",
        ])
        let next = waitForOutingReview(in: app)
        focusCurrentLocation(in: app).tap()
        XCTAssertTrue(waitForLocation("Carkeek Park", in: app))
        next.tap()
        XCTAssertTrue(app.staticTexts["confirm.speciesName"].existsOrWait(timeout: 10))
        app.buttons.matching(NSPredicate(format: "label IN %@", ["More", "ellipsis"])).firstMatch.tap()
        app.buttons["Skip Photo"].tap()
        XCTAssertTrue(app.navigationBars["Outing 2 of 2"].existsOrWait(timeout: 5))
        XCTAssertFalse(app.buttons["outing.useCurrentLocation"].exists)
        let adjustLocation = app.buttons["outing.adjustLocation"]
        XCTAssertEqual(locationValue(adjustLocation), "")
        XCTAssertFalse((adjustLocation.value as? String ?? "").contains("Current location"))
        XCTAssertFalse(app.staticTexts["Current location"].exists)
        XCTAssertFalse(app.staticTexts["outing.locationName"].exists)
        openLocationPicker(in: app)
        XCTAssertTrue(app.buttons["outing.useCurrentLocation"].existsOrWait(timeout: 5))
        returnToReview(in: app)
    }

    func testCurrentLocationControlsAtAccessibilityTextSize() {
        let app = launchCurrentLocationReview([
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
            "--ui-test-current-location-denied",
        ])
        _ = waitForOutingReview(in: app)
        let button = focusCurrentLocation(in: app)
        XCTAssertTrue(scrollUntilVisible(button, in: app))
        captureLocationScreen("Missing GPS accessibility text size", in: app)
        button.tap()
        XCTAssertTrue(scrollUntilVisible(app.staticTexts["outing.currentLocationError"], in: app))
        captureLocationScreen("Denied accessibility text size", in: app)
    }

    func testKnownPhotoReachesConfirmStepWithTheRightSpecies() {
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: Self.photoPath),
            "Fixture missing at \(Self.photoPath)"
        )

        let app = launchApp(
            autoSignIn: false,
            extraArguments: ["--ui-test-clear-data"]
        )

        let continueButton = waitForOutingReview(in: app)
        let adjustLocation = app.buttons["outing.adjustLocation"]
        XCTAssertTrue(
            (adjustLocation.value as? String ?? "").contains("GPS detected"),
            "Outing review did not detect the injected GPS coordinates"
        )
        XCTAssertEqual(app.descendants(matching: .any)["outing.gpsStatus"].label, "GPS detected")
        XCTAssertTrue(app.descendants(matching: .any)["outing.gpsCoordinates"].exists)
        startNewOuting(in: app)
        XCTAssertTrue(
            adjustLocation.existsOrWait(timeout: 15),
            "Location button was missing"
        )
        XCTAssertTrue(
            scrollUntilVisible(adjustLocation, in: app),
            "Resolved outing location was missing"
        )
        XCTAssertTrue(waitForLocation("Carkeek Park", in: app))
        XCTAssertEqual(
            locationValue(adjustLocation),
            "Carkeek Park",
            "Reverse geocoding did not resolve the known fixture coordinate"
        )
        XCTAssertFalse(app.descendants(matching: .any)["outing.locationLookupError"].exists)
        XCTAssertFalse(app.staticTexts["outing.locationName"].exists)
        continueButton.tap()

        // A sub-0.8 result routes to the crop prompt instead of the confirm step, and
        // the injected photo carries no location, so the prior cannot sharpen the
        // scores. Back out of the crop and keep the candidates we already have.
        let species = app.staticTexts["confirm.speciesName"]
        let cropBack = app.buttons["crop.back"]
        let identificationDestination = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier IN %@", ["confirm.speciesName", "crop.back"])
        ).firstMatch
        // The model is loaded and compiled on first use, which is slow in the simulator.
        XCTAssertTrue(
            identificationDestination.existsOrWait(timeout: 180),
            "Identification produced neither candidates nor a crop prompt"
        )
        if cropBack.exists {
            let actionableCropBack = app.buttons.matching(
                NSPredicate(format: "identifier == %@ AND hittable == true", "crop.back")
            ).firstMatch
            XCTAssertTrue(actionableCropBack.existsOrWait(timeout: 10))
            actionableCropBack.tap()
            XCTAssertTrue(
                species.existsOrWait(timeout: 30),
                "Never reached the confirm step after keeping the existing crop"
            )
        } else {
            XCTAssertTrue(species.exists, "Never reached the confirm step with an identified species")
        }
        XCTAssertEqual(species.label, Self.expectedSpecies)

        let confidence = app.staticTexts["confirm.confidence"]
        XCTAssertTrue(confidence.exists, "Confidence was missing from the species card")
        XCTAssertTrue(
            confidence.label.hasSuffix("%"),
            "Expected a percentage, got \(confidence.label)"
        )
        XCTAssertNotEqual(confidence.label, "0%", "Confidence should never round away to zero")

        app.buttons["confirm.accept"].tap()
        let done = app.buttons["upload.done"]
        XCTAssertTrue(done.existsOrWait(timeout: 30), "The anonymous outing did not finish saving")
        done.tap()
        XCTAssertTrue(
            app.staticTexts["Keep your"].existsOrWait(timeout: 10),
            "The first anonymous save did not show the durability prompt"
        )
        XCTAssertTrue(app.staticTexts["auth.accountDurability"].exists)
        XCTAssertFalse(app.buttons["Delete Data"].exists)
        app.buttons["Close"].tap()
        let accountButton = app.buttons["Log in"]
        XCTAssertEqual(
            accountButton.value as? String,
            "These sightings are only on this device"
        )
        accountButton.tap()
        XCTAssertTrue(app.staticTexts["Keep your"].existsOrWait(timeout: 10))
        XCTAssertFalse(app.staticTexts["Keep your sightings"].exists)
        XCTAssertFalse(app.staticTexts["Keep this WingDex or switch accounts"].exists)
        XCTAssertFalse(app.buttons["Export sightings as CSV"].exists)
    }

    func testLowConfidenceIdentificationOffersInteractiveCropZoom() {
        let app = launchApp(extraArguments: ["--ui-test-stub-low-confidence-identification"])
        let continueButton = waitForOutingReview(in: app)
        startNewOuting(in: app)
        continueButton.tap()

        let cropBack = app.buttons["crop.back"]
        let cropViewport = app.scrollViews["crop.viewport"]
        let offCenterPinchTarget = app.descendants(matching: .any)["crop.offCenterPinchTarget"]
        let zoomIn = app.buttons["crop.zoomIn"]
        let zoomOut = app.buttons["crop.zoomOut"]
        XCTAssertTrue(cropBack.existsOrWait(timeout: 10), "Low-confidence result did not enter crop mode")
        XCTAssertTrue(cropViewport.exists, "Crop viewport was missing")
        XCTAssertTrue(cropViewport.isHittable, "Crop viewport was not interactive through its overlay")
        XCTAssertTrue(offCenterPinchTarget.exists, "Off-center crop gesture target was missing")
        let initialCenter = cropCenterValue(offCenterPinchTarget)
        let initialZoom = cropZoomValue(cropViewport)
        offCenterPinchTarget.pinch(withScale: 1.5, velocity: 1)
        let pinchedZoom = waitForCropZoomChange(cropViewport, from: initialZoom, operation: "pinch")
        XCTAssertGreaterThan(pinchedZoom, initialZoom)
        let pinchedCenter = cropCenterValue(offCenterPinchTarget)
        XCTAssertLessThan(pinchedCenter.x, initialCenter.x, "Off-center pinch did not move crop center left")
        XCTAssertLessThan(pinchedCenter.y, initialCenter.y, "Off-center pinch did not move crop center up")
        XCTAssertTrue(zoomIn.exists, "Crop zoom-in control was missing")
        XCTAssertTrue(zoomOut.exists, "Crop zoom-out control was missing")
        XCTAssertTrue(zoomIn.isEnabled, "Crop zoom-in control was disabled below maximum zoom")
        let beforeZoomIn = cropZoomValue(cropViewport)
        zoomIn.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let zoomedIn = waitForCropZoomChange(cropViewport, from: beforeZoomIn, operation: "zoom in")
        XCTAssertGreaterThan(zoomedIn, beforeZoomIn)
        let beforeZoomOut = cropZoomValue(cropViewport)
        XCTAssertTrue(zoomOut.isEnabled, "Crop zoom-out control was disabled above minimum zoom")
        zoomOut.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let zoomedOut = waitForCropZoomChange(cropViewport, from: beforeZoomOut, operation: "zoom out")
        XCTAssertLessThan(zoomedOut, beforeZoomOut)
    }

    private func cropZoomValue(_ viewport: XCUIElement) -> Double {
        guard let value = viewport.value as? String, let zoom = Double(value) else {
            XCTFail("Crop viewport did not expose a numeric zoom value")
            return .nan
        }
        return zoom
    }

    private func cropCenterValue(_ target: XCUIElement) -> (x: Double, y: Double) {
        guard let value = target.value as? String else {
            XCTFail("Crop target did not expose its center")
            return (.nan, .nan)
        }
        let coordinates = value.split(separator: ",").compactMap { Double($0) }
        guard coordinates.count == 2 else {
            XCTFail("Crop target exposed an invalid center: \(value)")
            return (.nan, .nan)
        }
        return (coordinates[0], coordinates[1])
    }

    private func waitForCropZoomChange(
        _ viewport: XCUIElement,
        from previous: Double,
        operation: String
    ) -> Double {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                guard let value = viewport.value as? String, let zoom = Double(value) else { return false }
                return zoom != previous
            },
            object: viewport
        )
        let result = XCTWaiter.wait(for: [expectation], timeout: 5)
        let current = cropZoomValue(viewport)
        XCTAssertEqual(
            result,
            .completed,
            "Crop \(operation) did not change zoom from \(previous); current value is \(current)"
        )
        return current
    }

    func testColdSessionlessShareReachesOutingReview() {
        let app = application()
        app.launchArguments = [
            "--ui-test-sign-out",
            "--ui-test-reset-signup-prompt",
            "--ui-test-delay-session-enrichment",
            "--ui-test-share-store",
            "--ui-test-reset-share-store",
            "--ui-test-stage-share",
        ]
        app.launch()

        XCTAssertTrue(
            app.buttons["Continue"].existsOrWait(timeout: 30),
            "Queued shared photo never reached outing review"
        )
    }

    func testIncompleteShareIsDiscardedAfterRelaunch() {
        let app = application()
        app.launchArguments = [
            "--ui-test-sign-out",
            "--ui-test-share-store",
            "--ui-test-reset-share-store",
            "--ui-test-stage-share",
        ]
        app.launch()

        XCTAssertTrue(
            app.buttons["Continue"].existsOrWait(timeout: 30),
            "Queued shared photo never reached outing review"
        )

        app.terminate()
        app.launchArguments = [
            "--ui-test-sign-out",
            "--ui-test-share-store",
            "--ui-test-observe-share-queue",
        ]
        app.launch()

        XCTAssertTrue(
            app.descendants(matching: .any)["ui-test.shareQueueChecked"].existsOrWait(timeout: 30),
            "The share queue was not checked after relaunch"
        )
        XCTAssertFalse(app.buttons["Continue"].exists, "The interrupted shared-photo flow reappeared")
    }

    func testAlreadyLoadedSessionlessAppReceivesStagedShare() {
        let app = application()
        app.launchArguments = [
            "--ui-test-sign-out",
            "--ui-test-share-store",
            "--ui-test-reset-share-store",
            "--ui-test-stage-share-after-launch",
        ]
        app.launch()

        XCTAssertTrue(app.buttons["Home"].existsOrWait(timeout: 30))
        XCTAssertTrue(
            app.buttons["Continue"].existsOrWait(timeout: 30),
            "A share staged after launch was not delivered to the loaded app"
        )
    }

    func testSessionlessShareBootstrapFailureShowsRetry() {
        let app = application()
        app.launchEnvironment["API_BASE_URL"] = "http://127.0.0.1:1"
        app.launchArguments = [
            "--ui-test-sign-out",
            "--ui-test-share-store",
            "--ui-test-reset-share-store",
            "--ui-test-stage-share",
        ]
        app.launch()

        let alert = app.alerts["Could Not Continue"]
        XCTAssertTrue(alert.existsOrWait(timeout: 30), "Share bootstrap failure stayed invisible")
        XCTAssertTrue(alert.buttons["Retry"].exists)
        XCTAssertTrue(alert.buttons["Close Upload"].exists)
        alert.buttons["Close Upload"].tap()
        XCTAssertTrue(alert.disappearsOrWait(timeout: 10))
        XCTAssertFalse(app.buttons["Continue"].exists, "Explicit close immediately reopened the queued share")

        app.terminate()
        app.launchEnvironment["API_BASE_URL"] = apiBaseURL.absoluteString
        app.launchArguments = [
            "--ui-test-sign-out",
            "--ui-test-share-store",
            "--ui-test-observe-share-queue",
        ]
        app.launch()

        XCTAssertTrue(
            app.descendants(matching: .any)["ui-test.shareQueueChecked"].existsOrWait(timeout: 30),
            "The discarded shared-photo batch remained queued after relaunch"
        )
        XCTAssertFalse(app.buttons["Continue"].exists, "The discarded shared-photo batch reappeared")
    }

    func testAccessibilityAuditTimeoutClassification() {
        XCTAssertTrue(Self.isAccessibilityAuditInfrastructureTimeout(
            NSError(domain: "com.apple.xcode.xctest.accessibilityAudit", code: -56)
        ))
        XCTAssertFalse(Self.isAccessibilityAuditInfrastructureTimeout(
            NSError(domain: "com.apple.xcode.xctest.accessibilityAudit", code: -55)
        ))
        XCTAssertFalse(Self.isAccessibilityAuditInfrastructureTimeout(
            NSError(domain: NSCocoaErrorDomain, code: -56)
        ))
    }

    func testSubmittedPlaceSearchAppliesNormalizedResultAndRestoresGPS() async throws {
        let app = launchApp(extraArguments: [
            "--ui-test-fixture-empty",
            "--ui-test-geocoding-success",
            "--ui-test-place-search-result",
            "--ui-test-stub-identification",
        ])
        let continueButton = waitForOutingReview(in: app)

        startNewOuting(in: app)
        let adjustLocation = app.buttons["outing.adjustLocation"]
        XCTAssertTrue(adjustLocation.existsOrWait(timeout: 15))
        XCTAssertTrue(scrollUntilVisible(adjustLocation, in: app))
        let gpsLabel = locationValue(adjustLocation)
        openLocationPicker(in: app)
        setLocationQuery("Discovery Park Seattle\n", in: app)
        let firstResult = app.buttons.matching(identifier: "outing.locationResult").firstMatch
        XCTAssertTrue(firstResult.existsOrWait(timeout: 30), "Explicit place search returned no result")
        let selectedLabel = firstResult.label
        firstResult.tap()
        let selectedValue = locationValue(adjustLocation)
        XCTAssertFalse(selectedValue.isEmpty, "Tapping a result did not set the location name")
        XCTAssertEqual(app.descendants(matching: .any)["outing.gpsStatus"].label, "Location set from search")
        // The row reads "<place>, <context>"; only the place name becomes the outing name.
        XCTAssertTrue(
            selectedLabel.hasPrefix(selectedValue),
            "Expected \(selectedLabel) to start with the applied name \(selectedValue)"
        )
        XCTAssertTrue(
            scrollUntilVisible(app.descendants(matching: .any)["outing.locationAttribution"], in: app),
            "Static provider attribution was not visible"
        )
        openLocationPicker(in: app)
        let useGPS = app.buttons["outing.locationRestore"]
        XCTAssertTrue(scrollUntilVisible(useGPS, in: app), "Selecting a search result replaced the GPS suggestion")
        XCTAssertTrue(useGPS.label.hasPrefix("Use GPS: \(gpsLabel)"))
        useGPS.tap()
        XCTAssertEqual(locationValue(adjustLocation), gpsLabel)
        XCTAssertEqual(app.descendants(matching: .any)["outing.gpsStatus"].label, "GPS detected")
        XCTAssertTrue(app.descendants(matching: .any)["outing.locationAttribution"].exists)
        continueButton.tap()
        XCTAssertTrue(
            app.staticTexts["confirm.speciesName"].existsOrWait(timeout: 10),
            "Continuing after place selection did not reach species confirmation"
        )
    }

    func testLocationPickerShowsNearbyPlacesWithoutTyping() async throws {
        let app = launchApp(extraArguments: ["--ui-test-fixture-empty", "--ui-test-geocoding-success"])
        _ = waitForOutingReview(in: app)

        startNewOuting(in: app)
        let adjustLocation = app.buttons["outing.adjustLocation"]
        XCTAssertTrue(adjustLocation.existsOrWait(timeout: 15))
        XCTAssertTrue(scrollUntilVisible(adjustLocation, in: app))

        openLocationPicker(in: app)
        let firstResult = app.buttons.matching(identifier: "outing.locationNearbyResult").firstMatch
        XCTAssertTrue(firstResult.existsOrWait(timeout: 30), "Nearby place suggestions did not appear")
        XCTAssertTrue(firstResult.isHittable, "Nearby place suggestions were not interactive")
        firstResult.tap()
        XCTAssertFalse(locationValue(adjustLocation).isEmpty, "Tapping a nearby place did not set the location name")
    }

    func testGeocodingFailureFallsBackToCoordinatesAndAllowsManualEntry() {
        let app = launchApp(extraArguments: [
            "--ui-test-fixture-empty",
            "--ui-test-geocoding-failure",
            "--ui-test-clear-last-location",
        ])
        _ = waitForOutingReview(in: app)

        startNewOuting(in: app)
        let adjustLocation = app.buttons["outing.adjustLocation"]
        XCTAssertTrue(adjustLocation.existsOrWait(timeout: 15))
        XCTAssertTrue(scrollUntilVisible(adjustLocation, in: app))
        XCTAssertEqual(locationValue(adjustLocation), "47.712\u{00B0}, -122.372\u{00B0}")
        XCTAssertTrue((adjustLocation.value as? String ?? "").contains("Location lookup failed"))
        XCTAssertFalse(app.descendants(matching: .any)["outing.locationLookupError"].exists)
        XCTAssertTrue(app.buttons["outing.locationRetry"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["outing.locationAttribution"].exists)

        openLocationPicker(in: app)
        setLocationQuery("Manual Test Location", in: app)
        let manualButton = app.buttons["outing.useEnteredName"]
        XCTAssertTrue(scrollUntilVisible(manualButton, in: app))
        manualButton.tap()
        let manualLocation = app.buttons.matching(identifier: "outing.adjustLocation").matching(
            NSPredicate(
                format: "label == %@",
                "Manual Test Location"
            )
        ).firstMatch
        XCTAssertTrue(
            manualLocation.existsOrWait(timeout: 5),
            "Manual location name was not applied"
        )
        XCTAssertFalse(
            (adjustLocation.value as? String ?? "").contains("Location lookup failed"),
            "Reverse lookup failure remained in button value after manual location entry"
        )
        XCTAssertFalse(
            app.descendants(matching: .any)["outing.locationLookupError"].exists,
            "Reverse lookup failure remained visible after manual location entry"
        )
        XCTAssertTrue(
            app.descendants(matching: .any)["outing.locationAttribution"].existsOrWait(timeout: 5),
            "Static attribution disappeared after manual location entry"
        )
    }

    func testSuccessfulEmptyGeocodingExplainsCoordinateFallbackWithoutRetry() {
        let app = launchApp(extraArguments: [
            "--ui-test-fixture-empty",
            "--ui-test-geocoding-empty",
        ])
        _ = waitForOutingReview(in: app)

        startNewOuting(in: app)
        let adjustLocation = app.buttons["outing.adjustLocation"]
        XCTAssertTrue(adjustLocation.existsOrWait(timeout: 15))
        XCTAssertTrue(scrollUntilVisible(adjustLocation, in: app))
        XCTAssertEqual(locationValue(adjustLocation), "47.712\u{00B0}, -122.372\u{00B0}")
        XCTAssertTrue((adjustLocation.value as? String ?? "").contains("No named place found nearby"))
        XCTAssertFalse(app.descendants(matching: .any)["outing.locationLookupEmpty"].exists)
        XCTAssertFalse(app.buttons["outing.locationRetry"].exists)

        openLocationPicker(in: app)
        setLocationQuery("Manual Test Location", in: app)
        let manualButton = app.buttons["outing.useEnteredName"]
        XCTAssertTrue(scrollUntilVisible(manualButton, in: app))
        manualButton.tap()
        let manualLocation = app.buttons.matching(identifier: "outing.adjustLocation").matching(
            NSPredicate(
                format: "label == %@",
                "Manual Test Location"
            )
        ).firstMatch
        XCTAssertTrue(manualLocation.existsOrWait(timeout: 5))
        XCTAssertFalse(
            (adjustLocation.value as? String ?? "").contains("No named place found nearby"),
            "Empty lookup hint remained in button value after manual location entry"
        )
        XCTAssertFalse(
            app.descendants(matching: .any)["outing.locationLookupEmpty"].exists,
            "Empty lookup hint remained visible after manual location entry"
        )
    }

    func testDismissingOutingReviewCancelsDelayedGeocoding() {
        let app = launchApp(extraArguments: [
            "--ui-test-fixture-empty",
            "--ui-test-geocoding-delay",
        ])
        let continueButton = waitForOutingReview(in: app, requireEnabled: false)
        // Declining a matched outing is what starts the lookup for that account state.
        startNewOuting(in: app)
        XCTAssertFalse(continueButton.isEnabled, "Delayed geocoding was not in progress")

        let adjustLocation = app.buttons["outing.adjustLocation"]
        XCTAssertTrue(adjustLocation.existsOrWait(timeout: 5))
        XCTAssertTrue((adjustLocation.value as? String ?? "").contains("Identifying location from GPS..."))
        XCTAssertTrue(app.buttons["outing.locationCancel"].exists)
        app.buttons["Close"].tap()
        XCTAssertTrue(app.alerts["Discard progress?"].existsOrWait(timeout: 5))
        app.alerts["Discard progress?"].buttons["Discard"].tap()
        XCTAssertTrue(
            app.buttons["Close"].disappearsOrWait(timeout: 5),
            "Wizard did not dismiss"
        )
        XCTAssertTrue(
            app.descendants(matching: .any).matching(
                NSPredicate(
                    format: "identifier == %@ AND value == %@",
                    "ui-test.dataSetupComplete",
                    "geocodingCancellationAcknowledged"
                )
            ).firstMatch
                .existsOrWait(timeout: 5),
            "Reverse geocoding did not acknowledge cancellation"
        )
        XCTAssertFalse(adjustLocation.exists)
        XCTAssertFalse(app.buttons["outing.locationCancel"].exists)
        XCTAssertFalse(app.staticTexts["outing.locationName"].exists)
        XCTAssertFalse(app.staticTexts["Identifying location from GPS..."].exists)
    }

    func testLocationSearchQueryCloseDiscardsUnselectedEdits() {
        let app = launchCurrentLocationReview([
            "--ui-test-current-location-success", "--ui-test-geocoding-success",
            "--ui-test-place-search-result",
        ])
        _ = waitForOutingReview(in: app)
        focusCurrentLocation(in: app).tap()
        let adjustLocation = app.buttons["outing.adjustLocation"]
        XCTAssertTrue(waitForLocation("Carkeek Park", in: app))

        openLocationPicker(in: app)
        setLocationQuery("Unsaved Query", in: app)
        returnToReview(in: app)

        XCTAssertEqual(locationValue(adjustLocation), "Carkeek Park")

        let searchField = openLocationPicker(in: app)
        XCTAssertEqual(searchField.value as? String, "Carkeek Park")
        returnToReview(in: app)
    }

    func testMapPreviewPresentsMapSheetWithPanPinchRecenterAndPreservesCoordinates() {
        let app = launchCurrentLocationReview([
            "--ui-test-current-location-success", "--ui-test-geocoding-success",
        ])
        _ = waitForOutingReview(in: app)
        focusCurrentLocation(in: app).tap()
        let adjustLocation = app.buttons["outing.adjustLocation"]
        XCTAssertTrue(waitForLocation("Carkeek Park", in: app))

        let mapPreview = mapPreviewElement(in: app)
        XCTAssertTrue(scrollUntilVisible(mapPreview, in: app))
        mapPreview.tap()

        let map = app.descendants(matching: .any).matching(identifier: "outing.map").firstMatch
        XCTAssertTrue(map.existsOrWait(timeout: 5))
        let recenter = app.buttons["outing.mapRecenter"]
        XCTAssertTrue(recenter.existsOrWait(timeout: 5))
        XCTAssertEqual(recenter.label, "Recenter on Carkeek Park. Current location. (47.7115, -122.3717)")
        XCTAssertEqual(mapCoordinatesText(in: app), "(47.7115, -122.3717)")
        XCTAssertFalse(app.staticTexts["outing.mapName"].exists)
        XCTAssertFalse(app.staticTexts["outing.mapCoordinates"].exists)
        XCTAssertTrue(app.buttons["outing.openAppleMaps"].exists)

        map.swipeLeft()
        map.pinch(withScale: 1.5, velocity: 1.0)
        XCTAssertEqual(mapCoordinatesText(in: app), "(47.7115, -122.3717)")

        recenter.tap()
        XCTAssertEqual(mapCoordinatesText(in: app), "(47.7115, -122.3717)")

        returnToReview(in: app)
        XCTAssertTrue(adjustLocation.existsOrWait(timeout: 5))
        XCTAssertEqual(locationValue(adjustLocation), "Carkeek Park")
        XCTAssertFalse(app.staticTexts["outing.locationName"].exists)
    }

    func testLocationSearchNativeClearButtonAndDismissal() {
        let app = launchCurrentLocationReview([
            "--ui-test-current-location-success", "--ui-test-geocoding-success",
            "--ui-test-place-search-result",
        ])
        _ = waitForOutingReview(in: app)
        focusCurrentLocation(in: app).tap()
        let adjustLocation = app.buttons["outing.adjustLocation"]
        XCTAssertTrue(waitForLocation("Carkeek Park", in: app))

        let searchField = openLocationPicker(in: app)

        setLocationQuery("Discovery", in: app)

        searchField.typeText("\n")
        let result = app.buttons.matching(identifier: "outing.locationResult").firstMatch
        XCTAssertTrue(result.existsOrWait(timeout: 10))

        searchField.tap()
        let clearButton = searchField.buttons["Clear text"]
        XCTAssertTrue(clearButton.exists)
        clearButton.tap()
        XCTAssertTrue(result.disappearsOrWait(timeout: 5))
        XCTAssertFalse(app.buttons["outing.useEnteredName"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["outing.currentSelectionRow"].exists)

        returnToReview(in: app)
        XCTAssertEqual(locationValue(adjustLocation), "Carkeek Park")
    }
}
