import XCTest

@MainActor
final class OutingLocationVisualUITests: BirdIdFlowUITestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testLightReviewSearchAndMapSheets() throws {
        try inspectJourney(appearance: "Light", largeText: false)
    }

    func testDarkAccessibilityLongLocation() throws {
        try inspectJourney(appearance: "Dark", largeText: true)
    }

    func testPhotoSheetStartsAtTappedPhotoSwipesAndPreservesReview() throws {
        let app = launchPhotoReview(count: 3, delayedLocation: true)
        defer { app.terminate() }
        let location = app.buttons["outing.adjustLocation"]
        XCTAssertTrue(location.waitForExistence(timeout: 15))
        XCTAssertFalse(app.buttons["outing.continue"].isEnabled)
        let second = thumbnail(2, of: 3, in: app)
        let secondID = second.identifier.replacingOccurrences(of: "outing.photo.", with: "")
        revealAndTap(second, in: app)
        let secondPage = app.images["outing.photoPage.\(secondID)"]
        XCTAssertTrue(app.navigationBars["Photo 2 of 3"].waitForExistence(timeout: 5))
        XCTAssertTrue(secondPage.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["outing.continue"].exists)
        capture(app, "Photo-sheet-selected-second")
        secondPage.swipeLeft()
        XCTAssertTrue(app.navigationBars["Photo 3 of 3"].waitForExistence(timeout: 5))
        capture(app, "Photo-sheet-swiped-third")
        app.images.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "outing.photoPage.")
        ).firstMatch.swipeRight()
        XCTAssertTrue(app.navigationBars["Photo 2 of 3"].waitForExistence(timeout: 5))
        app.buttons["outing.photosClose"].tap()
        XCTAssertTrue(location.waitForExistence(timeout: 5))
        let resolved = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label == 'Carkeek Park'"), object: location
        )
        XCTAssertEqual(XCTWaiter.wait(for: [resolved], timeout: 15), .completed, "Photo viewing must not cancel GPS lookup")
        XCTAssertEqual(app.staticTexts["outing.photosHeader"].label, "Photos (3)")

        let first = thumbnail(1, of: 3, in: app)
        revealAndTap(first, in: app)
        XCTAssertTrue(app.navigationBars["Photo 1 of 3"].waitForExistence(timeout: 5))
        dismissSheetByDraggingHeader(app, title: "Photo 1 of 3")
        XCTAssertTrue(location.waitForExistence(timeout: 5))
        XCTAssertEqual(location.label, "Carkeek Park")
        XCTAssertEqual(app.staticTexts["outing.photosHeader"].label, "Photos (3)")

        first.press(forDuration: 1)
        let remove = app.buttons["Remove Photo"]
        XCTAssertTrue(remove.waitForExistence(timeout: 5))
        remove.tap()
        let remaining = thumbnail(1, of: 2, in: app)
        XCTAssertTrue(remaining.waitForExistence(timeout: 5))
        XCTAssertEqual(remaining.identifier, "outing.photo.\(secondID)")
        revealAndTap(remaining, in: app)
        XCTAssertTrue(app.navigationBars["Photo 1 of 2"].waitForExistence(timeout: 5))
        XCTAssertTrue(secondPage.waitForExistence(timeout: 5))
        app.buttons["outing.photosClose"].tap()
        XCTAssertTrue(app.buttons["outing.continue"].waitForExistence(timeout: 5))
    }

    func testSinglePhotoSheetDismissesWithoutChangingPhotos() throws {
        let app = launchPhotoReview(count: 1)
        defer { app.terminate() }
        let photo = thumbnail(1, of: 1, in: app)
        XCTAssertTrue(photo.waitForExistence(timeout: 15))
        let photoID = photo.identifier.replacingOccurrences(of: "outing.photo.", with: "")
        revealAndTap(photo, in: app)
        XCTAssertTrue(app.navigationBars["Photo 1 of 1"].waitForExistence(timeout: 5))
        let page = app.images["outing.photoPage.\(photoID)"]
        XCTAssertTrue(page.waitForExistence(timeout: 5))
        page.swipeLeft()
        XCTAssertTrue(app.navigationBars["Photo 1 of 1"].exists)
        dismissSheetByDraggingHeader(app, title: "Photo 1 of 1")
        XCTAssertTrue(app.buttons["outing.continue"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["outing.photosHeader"].label, "Photos (1)")
    }

    private func launchPhotoReview(count: Int, delayedLocation: Bool = false) -> XCUIApplication {
        let folder = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("WingDex/Resources/CollagePhotos")
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-test-fixture-empty", "--ui-test-ignore-shares",
            "--ui-test-geocoding-success", "--ui-test-stub-identification",
            "--ui-test-lat", "47.7115", "--ui-test-lon", "-122.3717",
        ]
        if delayedLocation { app.launchArguments.append("--ui-test-geocoding-delay") }
        for index in 1...count {
            app.launchArguments += ["--ui-test-photo", folder.appendingPathComponent("collage\(index).jpg").path]
        }
        app.launch()
        return app
    }

    private func thumbnail(_ index: Int, of count: Int, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(
            format: "identifier BEGINSWITH %@ AND label == %@", "outing.photo.", "Photo \(index) of \(count)"
        )).firstMatch
    }

    func testLocationBarDoesNotShiftDuringLookupOrRetry() throws {
        let photo = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("WingDex/Resources/CollagePhotos/collage1.jpg")
        for outcome in ["success", "empty", "failure"] {
            let app = XCUIApplication()
            app.launchArguments = [
                "--ui-test-fixture-empty", "--ui-test-ignore-shares",
                "--ui-test-photo", photo.path,
                "--ui-test-lat", "47.7115", "--ui-test-lon", "-122.3717",
                "--ui-test-geocoding-delay", "--ui-test-geocoding-\(outcome)",
            ]
            app.launch()
            defer { app.terminate() }
            let cancel = app.buttons["outing.locationCancel"]
            XCTAssertTrue(cancel.waitForExistence(timeout: 10))
            let row = app.buttons["outing.adjustLocation"]
            let preview = app.buttons["outing.mapPreview"]
            let photos = app.staticTexts["outing.photosHeader"]
            let rowFrame = row.frame
            let mapFrame = preview.frame
            let photosFrame = photos.frame
            XCTAssertGreaterThanOrEqual(rowFrame.height, 44)
            capture(app, "Loading-\(outcome)")
            XCTAssertTrue(cancel.waitForNonExistence(timeout: 15))
            XCTAssertEqual(row.frame.minY, rowFrame.minY, accuracy: 1)
            XCTAssertEqual(row.frame.height, rowFrame.height, accuracy: 1)
            XCTAssertEqual(preview.frame, mapFrame)
            XCTAssertEqual(photos.frame.minY, photosFrame.minY, accuracy: 1)
            XCTAssertTrue(app.buttons["outing.continue"].isEnabled)
            capture(app, "Resolved-\(outcome)")
            if outcome == "failure" {
                app.buttons["outing.locationRetry"].tap()
                XCTAssertTrue(cancel.waitForExistence(timeout: 5))
                XCTAssertEqual(row.frame, rowFrame)
                XCTAssertEqual(photos.frame.minY, photosFrame.minY, accuracy: 1)
                cancel.tap()
                XCTAssertTrue(app.buttons["outing.locationRetry"].waitForExistence(timeout: 5))
                XCTAssertEqual(row.frame, rowFrame)
                XCTAssertEqual(photos.frame.minY, photosFrame.minY, accuracy: 1)
            }
        }
    }

    private func inspectJourney(appearance: String, largeText: Bool) throws {
        let photo = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("WingDex/Resources/CollagePhotos/collage1.jpg")
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-test-fixture-empty", "--ui-test-ignore-shares",
            "--ui-test-photo", photo.path,
            "--ui-test-lat", "47.71151234", "--ui-test-lon", "-122.37174567",
            "--ui-test-geocoding-success", "--ui-test-place-search-result",
            "--ui-test-stub-identification", "--ui-test-observe-map-camera",
            "-UIPreferredContentSizeCategoryName",
            largeText ? "UICTContentSizeCategoryAccessibilityL" : "UICTContentSizeCategoryL",
        ]
        app.launch()
        defer { app.terminate() }

        let location = app.buttons["outing.adjustLocation"]
        let adjust = app.buttons["outing.adjustLocation"]
        let preview = app.buttons["outing.mapPreview"]
        XCTAssertTrue(location.waitForExistence(timeout: 20))
        let geocoded = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label == %@", "Carkeek Park"), object: location
        )
        XCTAssertEqual(XCTWaiter.wait(for: [geocoded], timeout: 5), .completed)
        XCTAssertEqual(preview.frame.maxY, location.frame.minY, accuracy: 1)
        XCTAssertEqual(preview.frame.height, 200, accuracy: 1)
        XCTAssertTrue(app.staticTexts["outing.locationHeader"].exists)
        XCTAssertTrue(app.staticTexts["outing.gpsStatus"].exists)
        XCTAssertLessThan(app.staticTexts["outing.gpsStatus"].frame.maxY, preview.frame.minY)
        let rowHeight = location.frame.height
        capture(app, "\(appearance)-review")

        revealAndTap(adjust, in: app)
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        XCTAssertTrue(app.navigationBars["Adjust Location"].exists)
        XCTAssertTrue(app.buttons["outing.locationClose"].exists)
        XCTAssertFalse(app.buttons["outing.continue"].exists)
        XCTAssertLessThan(search.frame.minY, app.frame.height * 0.35, "Search must stay at the top of the sheet")
        capture(app, "\(appearance)-picker-initial")

        replaceSearch(search, with: "Unselected place")
        dismissSheetByDraggingHeader(app, title: "Adjust Location")
        XCTAssertTrue(adjust.waitForExistence(timeout: 5))
        XCTAssertEqual(location.label, "Carkeek Park")
        revealAndTap(adjust, in: app)
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        XCTAssertEqual(search.value as? String, "Carkeek Park")

        replaceSearch(search, with: "Discovery")
        let result = app.buttons.matching(identifier: "outing.locationResult").firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        capture(app, "\(appearance)-picker-results")
        revealAndTap(result, in: app)
        XCTAssertTrue(location.waitForExistence(timeout: 5))
        XCTAssertEqual(location.label, "Discovery Park")

        if largeText {
            revealAndTap(adjust, in: app)
            XCTAssertTrue(search.waitForExistence(timeout: 5))
            replaceSearch(search, with: "Discovery Park North Beach and Lighthouse Birding Area")
            let manual = app.buttons["outing.useEnteredName"]
            XCTAssertTrue(manual.waitForExistence(timeout: 5))
            revealAndTap(manual, in: app)
            XCTAssertTrue(location.waitForExistence(timeout: 5))
        }

        let acceptedName = location.label
        let acceptedSource = app.staticTexts["outing.gpsStatus"].label
        XCTAssertEqual(location.frame.height, rowHeight, accuracy: 1, "Long names must stay on one line")
        capture(app, "\(appearance)-review-before-map")
        revealAndTap(preview, in: app)
        let coordinates = app.buttons["outing.mapRecenter"]
        XCTAssertTrue(coordinates.waitForExistence(timeout: 5))
        XCTAssertEqual(mapCoordinatesText(in: app), "(47.6573, -122.4066)")
        XCTAssertEqual(coordinates.label, "Recenter on \(acceptedName). \(acceptedSource). (47.6573, -122.4066)")
        XCTAssertFalse(app.staticTexts["outing.mapName"].exists)
        XCTAssertFalse(app.staticTexts["outing.mapCoordinates"].exists)
        XCTAssertFalse(app.buttons["outing.continue"].exists)
        XCTAssertTrue(app.buttons["outing.mapClose"].exists)
        XCTAssertTrue(app.buttons["outing.openAppleMaps"].exists)
        capture(app, "\(appearance)-map")

        let map = app.maps.firstMatch
        XCTAssertTrue(map.exists)
        let recenter = app.buttons["outing.mapRecenter"]
        let camera = app.buttons["outing.openAppleMaps"]
        XCTAssertGreaterThan(map.frame.maxY, camera.frame.maxY, "Map must continue behind the floating glass button")
        XCTAssertGreaterThan(map.frame.height, app.frame.height * 0.7)
        map.swipeLeft()
        waitForCamera(camera) { $0.distance > 0 }
        recenter.tap()
        waitForCamera(camera) {
            abs($0.latitude - 47.6573) < 0.0001 && abs($0.longitude + 122.4066) < 0.0001
        }
        let initialCamera = try cameraValue(camera)
        XCTAssertEqual(initialCamera.latitude, 47.6573, accuracy: 0.001)
        XCTAssertEqual(initialCamera.longitude, -122.4066, accuracy: 0.001)
        map.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5))
            .press(forDuration: 0.05, thenDragTo: map.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.5)))
        waitForCamera(camera) { abs($0.longitude - initialCamera.longitude) > 0.0001 }
        let pannedCamera = try cameraValue(camera)
        map.pinch(withScale: 2, velocity: 1)
        waitForCamera(camera) { $0.distance < pannedCamera.distance * 0.8 }
        capture(app, "\(appearance)-map-panned-zoomed")
        recenter.tap()
        waitForCamera(camera) {
            abs($0.latitude - initialCamera.latitude) < 0.0001
                && abs($0.longitude - initialCamera.longitude) < 0.0001
                && abs($0.distance - initialCamera.distance) < 30
        }
        XCTAssertEqual(mapCoordinatesText(in: app), "(47.6573, -122.4066)")
        capture(app, "\(appearance)-map-recentered")
        app.buttons["outing.openAppleMaps"].tap()
        XCTAssertTrue(XCUIApplication(bundleIdentifier: "com.apple.Maps").wait(for: .runningForeground, timeout: 10))
        app.activate()
        XCTAssertTrue(coordinates.waitForExistence(timeout: 5))
        XCTAssertEqual(mapCoordinatesText(in: app), "(47.6573, -122.4066)")
        XCTAssertEqual(coordinates.label, "Recenter on \(acceptedName). \(acceptedSource). (47.6573, -122.4066)")
        dismissSheetByDraggingHeader(app, title: "Location")
        XCTAssertTrue(adjust.waitForExistence(timeout: 5))
        XCTAssertEqual(location.label, acceptedName)
        capture(app, "\(appearance)-review-returned")
    }

    private func dismissSheetByDraggingHeader(_ app: XCUIApplication, title: String) {
        let header = app.navigationBars[title]
        XCTAssertTrue(header.exists)
        header.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2))
            .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.95)))
        XCTAssertTrue(header.waitForNonExistence(timeout: 5))
    }

    private func cameraValue(_ element: XCUIElement) throws -> (latitude: Double, longitude: Double, distance: Double) {
        let value = try XCTUnwrap(element.value as? String)
        let components = value.split(separator: ",").compactMap { Double($0) }
        XCTAssertEqual(components.count, 3, "Camera callback has not supplied a measurement")
        guard components.count == 3 else { throw NSError(domain: "MapCamera", code: 1) }
        return (components[0], components[1], components[2])
    }

    private func waitForCamera(
        _ element: XCUIElement,
        matching predicate: @escaping ((latitude: Double, longitude: Double, distance: Double)) -> Bool
    ) {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let components = (element.value as? String ?? "").split(separator: ",").compactMap { Double($0) }
            return components.count == 3 && predicate((components[0], components[1], components[2]))
        }, object: nil)
        XCTAssertEqual(
            XCTWaiter.wait(for: [expectation], timeout: 5), .completed,
            "Actual map camera did not move as expected: \(element.value as? String ?? "missing")"
        )
    }

    private func replaceSearch(_ field: XCUIElement, with text: String) {
        field.tap()
        let clear = field.buttons["Clear text"]
        XCTAssertTrue(clear.exists)
        clear.tap()
        field.typeText(text)
        XCTAssertEqual(field.value as? String, text)
    }

    private func revealAndTap(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<6 {
            if element.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(element.isHittable)
        element.tap()
    }

    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
