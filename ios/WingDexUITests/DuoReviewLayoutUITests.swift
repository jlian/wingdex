import XCTest

@MainActor
final class DuoReviewLayoutUITests: BirdIdFlowUITestCase {
    func testExpandedReviewGutterStackedPhotosAndCrop() throws {
        let app = launchApp(extraArguments: [
            "--ui-test-geocoding-success", "--ui-test-stub-identification",
        ])
        let window = app.windows.firstMatch
        let bounds = window.frame
        try XCTSkipIf(
            bounds.width < 640 || bounds.width <= bounds.height,
            "Requires an unfolded, wide simulator window. Current window: \(bounds)."
        )
        let next = waitForOutingReview(in: app)

        capture("Outing_Review", in: window)
        let photosForm = app.collectionViews.containing(
            .staticText, identifier: "outing.photosHeader"
        ).firstMatch
        let metadataForm = app.collectionViews.containing(
            .button, identifier: "outing.adjustLocation"
        ).firstMatch
        XCTAssertTrue(photosForm.exists, app.debugDescription)
        XCTAssertTrue(metadataForm.exists, app.debugDescription)
        XCTAssertEqual(
            scrollingContainer(containing: app.buttons["outing.adjustLocation"], in: app).frame,
            metadataForm.frame
        )
        let photosRow = photosForm.cells.firstMatch.frame
        let metadataRow = metadataForm.cells.firstMatch.frame
        XCTAssertGreaterThanOrEqual(metadataRow.minX - photosRow.maxX, 24)
        let navigationControl = next.frame
        for cell in metadataForm.cells.allElementsBoundByIndex where cell.frame.intersects(bounds) {
            if navigationControl.midX > bounds.midX {
                XCTAssertLessThanOrEqual(cell.frame.maxX, navigationControl.minX - 8)
            } else {
                XCTAssertGreaterThanOrEqual(cell.frame.minX, navigationControl.maxX + 8)
            }
        }

        openLocationPicker(in: app)
        returnToReview(in: app)
        next.tap()
        XCTAssertTrue(app.staticTexts["confirm.speciesName"].existsOrWait(timeout: 10))
        let yours = app.buttons["confirm.userPhoto"]
        let reference = app.buttons["Explore \(Self.expectedSpecies)"]
        XCTAssertTrue(yours.isHittable)
        XCTAssertTrue(reference.isHittable)
        XCTAssertGreaterThanOrEqual(yours.frame.width, 200)
        XCTAssertLessThan(yours.frame.maxY, reference.frame.minY)
        XCTAssertEqual(yours.frame.midX, reference.frame.midX, accuracy: 1)
        XCTAssertEqual(yours.frame.width, reference.frame.width, accuracy: 1)
        XCTAssertTrue(bounds.contains(reference.frame))
        capture("Stacked_Comparison", in: window)

        yours.tap()
        let viewport = app.scrollViews["crop.viewport"]
        XCTAssertTrue(viewport.existsOrWait(timeout: 5))
        XCTAssertTrue(viewport.isHittable)
        XCTAssertTrue(bounds.contains(viewport.frame))
        capture("Crop_Background", in: window)
    }

    private func capture(_ name: String, in window: XCUIElement) {
        // XCUIScreen.main can be Duo's inactive outer display.
        let attachment = XCTAttachment(screenshot: window.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
