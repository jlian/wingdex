import XCTest

@MainActor
final class OutingListRegressionUITests: BirdIdFlowUITestCase {
    private let outingName = "Parque Ibirapuera, Sao Paulo"

    func testOutingContextMenuHasOnlyDetailsAndNoSwipeActions() {
        let app = launchPopulatedOutings()
        let outing = outingRow(in: app)

        outing.press(forDuration: 1)

        let viewDetails = app.buttons["View Details"]
        XCTAssertTrue(viewDetails.existsOrWait(timeout: 10))
        XCTAssertFalse(app.buttons["Edit Location"].exists)
        XCTAssertFalse(app.buttons["Delete Outing"].exists)
        XCTAssertFalse(app.buttons["Share Summary"].exists)
        viewDetails.tap()
        let detailNavigationBar = app.navigationBars[outingName]
        XCTAssertTrue(detailNavigationBar.existsOrWait(timeout: 10))
        detailNavigationBar.buttons["Outings"].tap()

        outingRow(in: app).swipeLeft()
        XCTAssertFalse(app.buttons["Delete"].exists)
        outingRow(in: app).swipeRight()
        XCTAssertFalse(app.buttons["Export"].exists)
        XCTAssertEqual(app.state, .runningForeground)
    }

    func testRenameCancelAndDismissDiscardTheDraft() {
        let app = launchPopulatedOutings(allowsUpdates: true)
        outingRow(in: app).tap()
        openRename(in: app)
        app.textFields["outing.renameField"].typeText(" edited")
        app.buttons["outing.renameCancel"].tap()
        XCTAssertTrue(app.navigationBars[outingName].existsOrWait(timeout: 5))
        openRename(in: app)
        XCTAssertEqual(app.textFields["outing.renameField"].value as? String, outingName)
        app.textFields["outing.renameField"].typeText(" discarded")
        let titleBar = app.navigationBars["Rename Outing"]
        titleBar.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85)))
        XCTAssertTrue(app.buttons["outing.renameSave"].disappearsOrWait(timeout: 5))
        openRename(in: app)
        XCTAssertEqual(app.textFields["outing.renameField"].value as? String, outingName)
    }

    func testRenameSaveUpdatesDetails() {
        let app = launchPopulatedOutings(allowsUpdates: true)
        outingRow(in: app).tap()
        openRename(in: app)
        let field = app.textFields["outing.renameField"]
        field.typeText(" renamed")
        let updatedName = field.value as? String ?? ""
        app.buttons["outing.renameSave"].tap()
        XCTAssertTrue(app.buttons["outing.renameSave"].disappearsOrWait(timeout: 5))
        XCTAssertTrue(app.navigationBars[updatedName].existsOrWait(timeout: 5))
        openRename(in: app)
        XCTAssertEqual(app.textFields["outing.renameField"].value as? String, updatedName)
    }

    func testRenameFailureKeepsDraftForRetry() {
        let app = launchPopulatedOutings()
        outingRow(in: app).tap()
        openRename(in: app)
        let field = app.textFields["outing.renameField"]
        field.typeText(" retry")
        let draft = field.value as? String
        app.buttons["outing.renameSave"].tap()
        XCTAssertTrue(app.staticTexts["outing.renameError"].existsOrWait(timeout: 5))
        XCTAssertEqual(field.value as? String, draft)
        XCTAssertTrue(app.buttons["outing.renameSave"].isEnabled)
        app.buttons["outing.renameCancel"].tap()
        XCTAssertTrue(app.navigationBars[outingName].existsOrWait(timeout: 5))
    }

    func testOutingMenuAndDeleteCancellation() {
        let app = launchPopulatedOutings()
        outingRow(in: app).tap()
        XCTAssertFalse(app.buttons["Edit location name"].exists)
        XCTAssertFalse(app.buttons["Delete Outing"].exists)
        app.buttons["outing.actions"].tap()
        XCTAssertTrue(app.buttons["Share Summary"].existsOrWait(timeout: 5))
        XCTAssertTrue(app.buttons["outing.rename"].exists)
        app.buttons["outing.delete"].tap()
        let alert = app.alerts["Delete this outing?"]
        XCTAssertTrue(alert.existsOrWait(timeout: 5))
        alert.buttons["Cancel"].tap()
        XCTAssertTrue(app.navigationBars[outingName].exists)
    }

    func testHomeOutingRowsHaveNoSwipeActions() {
        let app = launchPopulatedApp()
        app.buttons["Home"].tap()
        let row = outingRow(in: app)
        row.swipeLeft()
        XCTAssertFalse(app.buttons["Delete"].exists)
        row.swipeRight()
        XCTAssertFalse(app.buttons["Export"].exists)
    }

    private func openRename(in app: XCUIApplication) {
        let actions = app.buttons["outing.actions"]
        XCTAssertTrue(actions.existsOrWait(timeout: 5))
        actions.tap()
        app.buttons["outing.rename"].tap()
        XCTAssertTrue(app.textFields["outing.renameField"].existsOrWait(timeout: 5))
    }

    private func launchPopulatedOutings(allowsUpdates: Bool = false) -> XCUIApplication {
        let app = launchPopulatedApp(allowsUpdates: allowsUpdates)
        app.buttons["Outings"].tap()
        XCTAssertTrue(app.navigationBars["Outings"].existsOrWait(timeout: 10))
        return app
    }

    private func launchPopulatedApp(allowsUpdates: Bool = false) -> XCUIApplication {
        let app = application()
        app.launchArguments = ["--ui-test-fixture-populated"]
        if allowsUpdates { app.launchArguments.append("--ui-test-allow-outing-updates") }
        app.launch()
        waitForDataSetup(in: app)
        return app
    }

    private func outingRow(in app: XCUIApplication) -> XCUIElement {
        let row = app.descendants(matching: .any).matching(
            NSPredicate(format: "label BEGINSWITH %@", outingName)
        ).firstMatch
        XCTAssertTrue(row.existsOrWait(timeout: 10))
        return row
    }
}
