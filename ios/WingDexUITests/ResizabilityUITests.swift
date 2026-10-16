import XCTest

@MainActor
final class ResizabilityUITests: BirdIdFlowUITestCase {
    func testControlVisibilityRequiresHorizontalAndVerticalClearance() {
        let viewport = CGRect(x: 80, y: 100, width: 400, height: 500)
        XCTAssertTrue(isCenterVisible(CGRect(x: 100, y: 120, width: 44, height: 44), in: viewport))
        for frame in [
            CGRect(x: 40, y: 120, width: 44, height: 44),
            CGRect(x: 450, y: 120, width: 44, height: 44),
            CGRect(x: 100, y: 60, width: 44, height: 44),
            CGRect(x: 100, y: 570, width: 44, height: 44),
        ] {
            XCTAssertFalse(isCenterVisible(frame, in: viewport), "Obstructed control: \(frame)")
        }
    }

    func testEmptyHomeControlsScrollWithAccessibilityText() {
        let app = application()
        app.launchArguments += [
            "--ui-test-fixture-empty", "--ui-test-ignore-shares",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
        ]
        app.launch()
        waitForDataSetup(in: app)

        let scroll = app.scrollViews["home.emptyContent"]
        XCTAssertTrue(scroll.existsOrWait(timeout: 5))
        let identify = app.buttons["Identify Birds"]
        XCTAssertTrue(
            scrollUntilVisible(identify, in: app, scrollingContainer: scroll),
            "Window: \(app.windows.firstMatch.frame), scroll: \(scroll.frame), button: \(identify.frame)\n\(app.debugDescription)"
        )
        XCTAssertTrue(app.windows.firstMatch.frame.contains(identify.frame))
        identify.tap()
        XCTAssertTrue(app.buttons["Choose from Library"].existsOrWait(timeout: 5))
    }

    func testDetailNotesKeepTheirPaneAndKeyboardFocus() {
        let app = application()
        app.launchArguments += ["--ui-test-fixture-populated", "--ui-test-ignore-shares"]
        app.launch()
        waitForDataSetup(in: app)

        let species = app.descendants(matching: .any).matching(
            NSPredicate(format: "label == %@", "Chalk-browed Mockingbird")
        ).firstMatch
        XCTAssertTrue(species.existsOrWait(timeout: 5))
        species.tap()

        for (identifier, label) in [("species.notes", "Add notes"), ("outing.notes", "UI test seed")] {
            let notesButton = app.buttons[label]
            XCTAssertTrue(scrollUntilVisible(notesButton, in: app))
            let paneCount = app.collectionViews.count
            notesButton.tap()
            XCTAssertTrue(app.keyboards.firstMatch.existsOrWait(timeout: 5))
            let editor = app.descendants(matching: .any).matching(identifier: identifier).firstMatch
            XCTAssertTrue(editor.existsOrWait(timeout: 5))
            XCTAssertEqual(app.collectionViews.count, paneCount)
            app.typeText("Still editing")
            XCTAssertTrue((editor.value as? String)?.hasSuffix("Still editing") == true)
            XCTAssertLessThanOrEqual(editor.frame.maxY, app.keyboards.firstMatch.frame.minY)
            app.buttons["Cancel"].tap()

            if identifier == "species.notes" {
                let sighting = app.buttons["species.sighting.ui-test-seeded-outing"]
                XCTAssertTrue(scrollUntilVisible(sighting, in: app))
                sighting.tap()
                XCTAssertTrue(app.navigationBars["Parque Ibirapuera, Sao Paulo"].existsOrWait(timeout: 5))
            }
        }
    }

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
