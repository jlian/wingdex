import XCTest

@MainActor
final class ResizabilityUITests: BirdIdFlowUITestCase {
    func testNativeToolbarGroupsKeepSortAndSettingsReachable() {
        let app = application()
        app.launchArguments += [
            "--ui-test-fixture-populated", "--ui-test-ignore-shares",
            "--ui-test-registered-blank-name",
        ]
        app.launch()
        waitForDataSetup(in: app)
        let window = app.windows.firstMatch

        for tab in ["Home", "WingDex", "Outings"] {
            app.buttons[tab].tap()
            if tab != "Home" {
                let sort = app.buttons["Sort"]
                XCTAssertTrue(sort.isHittable, app.debugDescription)
                sort.tap()
                let name = app.buttons["Name"]
                XCTAssertTrue(name.existsOrWait(timeout: 5), app.debugDescription)
                name.tap()
            }

            let attachment = XCTAttachment(screenshot: window.screenshot())
            attachment.name = "\(tab)_Native_Toolbar"
            attachment.lifetime = .keepAlways
            add(attachment)

            let settings = app.buttons["Settings"]
            XCTAssertTrue(settings.isHittable, app.debugDescription)
            settings.tap()
            XCTAssertTrue(app.textFields["settings.displayName"].existsOrWait(timeout: 5))
            app.buttons["Done"].tap()
        }
    }

    func testPhotoSelectionRemainsReachableWithAccessibilityText() {
        let app = application()
        app.launchArguments += [
            "--ui-test-fixture-empty", "--ui-test-ignore-shares",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
        ]
        app.launch()
        waitForDataSetup(in: app)
        let window = app.windows.firstMatch
        app.buttons["Add"].tap()

        let library = app.buttons["Choose from Library"]
        XCTAssertTrue(library.existsOrWait(timeout: 5))
        app.scrollViews.firstMatch.swipeUp()
        XCTAssertTrue(window.frame.contains(app.buttons["Take Photo"].frame))
        XCTAssertTrue(scrollUntilVisible(library, in: app), app.debugDescription)
        XCTAssertTrue(window.frame.contains(library.frame))
        XCTAssertLessThanOrEqual(library.frame.width, 480)
        XCTAssertTrue(app.staticTexts["Identify Birds"].exists)

        let attachment = XCTAttachment(screenshot: window.screenshot())
        attachment.name = "Photo_Selection_Accessibility_Text"
        attachment.lifetime = .keepAlways
        add(attachment)
        library.tap()
        XCTAssertTrue(app.buttons["Cancel"].existsOrWait(timeout: 5), app.debugDescription)
    }
}
