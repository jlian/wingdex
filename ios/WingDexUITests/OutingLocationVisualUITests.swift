import XCTest

@MainActor
final class OutingLocationVisualUITests: BirdIdFlowUITestCase {
    func testPhotoSheetSelectionSwipeRemovalAndDismissalPreserveReview() {
        let folder = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("WingDex/Resources/CollagePhotos")
        let app = launchApp(extraArguments: [
            "--ui-test-geocoding-success", "--ui-test-stub-identification",
            "--ui-test-photo", folder.appendingPathComponent("collage1.jpg").path,
            "--ui-test-photo", folder.appendingPathComponent("collage2.jpg").path,
        ])
        _ = waitForOutingReview(in: app)
        XCTAssertFalse(app.staticTexts["outing.locationHeader"].exists)
        let second = thumbnail(2, of: 3, in: app)
        let secondID = second.identifier.replacingOccurrences(of: "outing.photo.", with: "")
        XCTAssertTrue(scrollUntilVisible(second, in: app))
        second.tap()
        let secondPage = app.images["outing.photoPage.\(secondID)"]
        XCTAssertTrue(app.navigationBars["Photo 2 of 3"].existsOrWait(timeout: 5))
        XCTAssertTrue(secondPage.existsOrWait(timeout: 5))
        let pager = app
        let thirdPage = app.images.matching(NSPredicate(format: "label == %@", "Photo 3 of 3")).firstMatch
        assertCentered(secondPage, in: pager)
        for _ in 0..<3 {
            pager.swipeLeft()
            XCTAssertTrue(app.navigationBars["Photo 3 of 3"].existsOrWait(timeout: 5))
            assertCentered(thirdPage, in: pager)
            pager.swipeRight()
            XCTAssertTrue(app.navigationBars["Photo 2 of 3"].existsOrWait(timeout: 5))
            assertCentered(secondPage, in: pager)
        }
        pager.coordinate(withNormalizedOffset: CGVector(dx: 0.6, dy: 0.5))
            .press(
                forDuration: 0.05,
                thenDragTo: pager.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)),
                withVelocity: .slow,
                thenHoldForDuration: 0.2
            )
        assertCentered(secondPage, in: pager)
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "Photo_Pager"
        attachment.lifetime = .keepAlways
        add(attachment)
        app.buttons["outing.photosClose"].tap()
        XCTAssertTrue(app.buttons["outing.continue"].existsOrWait(timeout: 5))
        XCTAssertEqual(locationValue(in: app), "Carkeek Park")

        let first = thumbnail(1, of: 3, in: app)
        XCTAssertTrue(scrollUntilVisible(first, in: app))
        first.press(forDuration: 1)
        let remove = app.buttons["Remove Photo"]
        XCTAssertTrue(remove.existsOrWait(timeout: 5))
        remove.tap()
        let remaining = thumbnail(1, of: 2, in: app)
        XCTAssertTrue(remaining.existsOrWait(timeout: 5))
        XCTAssertEqual(remaining.identifier, "outing.photo.\(secondID)")
        remaining.tap()
        XCTAssertTrue(secondPage.existsOrWait(timeout: 5))
        dismissSheet(app, title: "Photo 1 of 2")
        XCTAssertTrue(app.buttons["outing.continue"].existsOrWait(timeout: 5))
        XCTAssertEqual(app.staticTexts["outing.photosHeader"].label, "Photos (2)")
    }

    func testSearchAndMapSheetsAtLargeTextSize() throws {
        let app = launchApp(extraArguments: [
            "--ui-test-geocoding-success", "--ui-test-place-search-result",
            "--ui-test-stub-identification", "--ui-test-observe-map-camera",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityL",
        ])
        _ = waitForOutingReview(in: app)
        let location = app.buttons["outing.adjustLocation"]
        let preview = mapPreviewElement(in: app)
        XCTAssertTrue(scrollUntilVisible(location, in: app))
        XCTAssertEqual(preview.frame.maxY, location.frame.minY, accuracy: 1)
        let rowHeight = location.frame.height

        openLocationPicker(in: app)
        let search = app.searchFields.firstMatch
        XCTAssertLessThan(search.frame.minY, app.frame.height * 0.35)
        setLocationQuery("Unselected place", in: app)
        dismissSheet(app, title: "Adjust Location")
        XCTAssertTrue(scrollUntilVisible(location, in: app))
        XCTAssertEqual(location.label, "Carkeek Park")
        openLocationPicker(in: app)
        XCTAssertEqual(search.value as? String, "Carkeek Park")
        setLocationQuery("Discovery", in: app)
        let result = app.buttons.matching(identifier: "outing.locationResult").firstMatch
        XCTAssertTrue(result.existsOrWait(timeout: 5))
        result.tap()
        XCTAssertTrue(search.disappearsOrWait(timeout: 5))
        XCTAssertTrue(scrollUntilVisible(location, in: app))
        XCTAssertEqual(location.label, "Discovery Park")

        openLocationPicker(in: app)
        setLocationQuery("Discovery Park North Beach and Lighthouse Birding Area", in: app)
        let manual = app.buttons["outing.useEnteredName"]
        XCTAssertTrue(scrollUntilVisible(manual, in: app))
        manual.tap()
        XCTAssertTrue(search.disappearsOrWait(timeout: 5))
        XCTAssertTrue(scrollUntilVisible(location, in: app))
        XCTAssertEqual(location.frame.height, rowHeight, accuracy: 1)
        let name = location.label
        XCTAssertTrue(scrollUntilVisible(preview, in: app))
        preview.tap()
        XCTAssertEqual(mapCoordinatesText(in: app), "(47.6573, -122.4066)")
        let map = app.maps.firstMatch
        XCTAssertTrue(map.exists)
        let camera = app.buttons["outing.openAppleMaps"]
        let recenter = app.buttons["outing.mapRecenter"]
        XCTAssertTrue(recenter.label.contains(name))
        XCTAssertGreaterThan(map.frame.maxY, camera.frame.maxY)
        let initial = try cameraValue(camera)
        map.swipeLeft()
        waitForCamera(camera) { abs($0.longitude - initial.longitude) > 0.0001 }
        map.pinch(withScale: 2, velocity: 1)
        waitForCamera(camera) { $0.distance < initial.distance * 0.8 }
        recenter.tap()
        waitForCamera(camera) {
            abs($0.latitude - initial.latitude) < 0.0001
                && abs($0.longitude - initial.longitude) < 0.0001
        }
        XCTAssertEqual(mapCoordinatesText(in: app), "(47.6573, -122.4066)")
        returnToReview(in: app)
        XCTAssertTrue(scrollUntilVisible(location, in: app))
        XCTAssertEqual(location.label, name)
    }

    func testLocationBarDoesNotShiftDuringFailureAndRetry() {
        let app = launchApp(extraArguments: [
            "--ui-test-geocoding-delay", "--ui-test-geocoding-failure",
        ])
        _ = waitForOutingReview(in: app, requireEnabled: false)
        let cancel = app.buttons["outing.locationCancel"]
        XCTAssertTrue(cancel.existsOrWait(timeout: 5))
        let row = app.buttons["outing.adjustLocation"]
        XCTAssertEqual(row.label, "Looking up location...")
        XCTAssertTrue(app.descendants(matching: .any)["outing.gpsCoordinates"].exists)
        let photos = app.staticTexts["outing.photosHeader"]
        let rowFrame = row.frame
        let photosFrame = photos.frame
        XCTAssertGreaterThanOrEqual(rowFrame.height, 44)
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "Reverse_Geocoding_Loading"
        attachment.lifetime = .keepAlways
        add(attachment)
        XCTAssertTrue(cancel.disappearsOrWait(timeout: 15))
        XCTAssertEqual(row.label, "47.712\u{00B0}, -122.372\u{00B0}")
        XCTAssertEqual(row.frame, rowFrame)
        XCTAssertEqual(photos.frame.minY, photosFrame.minY, accuracy: 1)
        app.buttons["outing.locationRetry"].tap()
        XCTAssertTrue(cancel.existsOrWait(timeout: 5))
        XCTAssertEqual(row.label, "Looking up location...")
        XCTAssertEqual(row.frame, rowFrame)
        cancel.tap()
        XCTAssertTrue(app.buttons["outing.locationRetry"].existsOrWait(timeout: 5))
        XCTAssertEqual(row.label, "47.712\u{00B0}, -122.372\u{00B0}")
        XCTAssertEqual(row.frame, rowFrame)
    }

    func testLocationLoadingResolvesToPlaceNameAtLargeTextSize() {
        let app = launchApp(extraArguments: [
            "--ui-test-geocoding-delay", "--ui-test-geocoding-success",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityL",
        ])
        let continueButton = waitForOutingReview(in: app, requireEnabled: false)
        let row = app.buttons["outing.adjustLocation"]
        XCTAssertEqual(row.label, "Looking up location...")
        XCTAssertTrue(scrollUntilVisible(row, in: app))
        let rowFrame = row.frame
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "Reverse_Geocoding_Loading_Large_Text"
        attachment.lifetime = .keepAlways
        add(attachment)
        XCTAssertTrue(row.labelOrWait("Carkeek Park", timeout: 15))
        XCTAssertTrue(continueButton.isEnabled)
        XCTAssertEqual(row.frame, rowFrame)
    }

    private func thumbnail(_ index: Int, of count: Int, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(
            format: "identifier BEGINSWITH %@ AND label == %@", "outing.photo.", "Photo \(index) of \(count)"
        )).firstMatch
    }

    private func assertCentered(_ page: XCUIElement, in pager: XCUIElement) {
        let centered = NSPredicate { _, _ in
            page.exists && page.frame.width > 0 && abs(page.frame.midX - pager.frame.midX) < 1
        }
        let expectation = XCTNSPredicateExpectation(predicate: centered, object: nil)
        let result = XCTWaiter.wait(for: [expectation], timeout: 5)
        if result != .completed {
            let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            attachment.name = "Unsettled_Photo_Page"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        XCTAssertEqual(result, .completed, "Photo: \(page.frame), viewer: \(pager.frame)")
    }

    private func dismissSheet(_ app: XCUIApplication, title: String) {
        let header = app.navigationBars[title]
        header.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2))
            .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.95)))
        XCTAssertTrue(header.disappearsOrWait(timeout: 5))
    }

    private func cameraValue(_ element: XCUIElement) throws -> (latitude: Double, longitude: Double, distance: Double) {
        let value = try XCTUnwrap(element.value as? String)
        let components = value.split(separator: ",").compactMap { Double($0) }
        guard components.count == 3 else { throw NSError(domain: "MapCamera", code: 1) }
        return (components[0], components[1], components[2])
    }

    private func waitForCamera(
        _ element: XCUIElement,
        matching predicate: @escaping ((latitude: Double, longitude: Double, distance: Double)) -> Bool
    ) {
        let condition = NSPredicate { _, _ in
            let components = (element.value as? String ?? "").split(separator: ",").compactMap { Double($0) }
            return components.count == 3 && predicate((components[0], components[1], components[2]))
        }
        if condition.evaluate(with: nil) { return }
        let expectation = XCTNSPredicateExpectation(predicate: condition, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 5), .completed)
    }
}
