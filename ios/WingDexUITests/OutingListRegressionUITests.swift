import XCTest

@MainActor
final class OutingListRegressionUITests: BirdIdFlowUITestCase {
    private let outingName = "Parque Ibirapuera, Sao Paulo"

    func testOutingActionsRenameAndDeleteCancellation() {
        let app = launchOutings(allowsUpdates: true)
        let outing = app.descendants(matching: .any).matching(
            NSPredicate(format: "label BEGINSWITH %@", outingName)
        ).firstMatch
        XCTAssertTrue(outing.existsOrWait(timeout: 5))
        outing.press(forDuration: 1)
        XCTAssertTrue(app.buttons["View Details"].existsOrWait(timeout: 5))
        XCTAssertFalse(app.buttons["Delete Outing"].exists)
        XCTAssertFalse(app.buttons["Share Summary"].exists)
        app.buttons["View Details"].tap()

        openRename(in: app)
        app.textFields["outing.renameField"].typeText(" discarded")
        app.buttons["outing.renameCancel"].tap()
        openRename(in: app)
        XCTAssertEqual(app.textFields["outing.renameField"].value as? String, outingName)
        app.textFields["outing.renameField"].typeText(" renamed")
        let name = app.textFields["outing.renameField"].value as? String ?? ""
        app.buttons["outing.renameSave"].tap()
        XCTAssertTrue(app.navigationBars[name].existsOrWait(timeout: 5))

        app.buttons["outing.actions"].tap()
        XCTAssertTrue(app.buttons["Share Summary"].existsOrWait(timeout: 5))
        app.buttons["outing.delete"].tap()
        let alert = app.alerts["Delete this outing?"]
        XCTAssertTrue(alert.existsOrWait(timeout: 5))
        alert.buttons["Cancel"].tap()
        XCTAssertTrue(app.navigationBars[name].exists)
        app.navigationBars[name].buttons["Outings"].tap()
        outing.swipeLeft()
        XCTAssertFalse(app.buttons["Delete"].exists)
    }

    func testRenameFailureKeepsDraftForRetry() {
        let app = launchOutings(allowsUpdates: false)
        app.descendants(matching: .any).matching(
            NSPredicate(format: "label BEGINSWITH %@", outingName)
        ).firstMatch.tap()
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

    private func openRename(in app: XCUIApplication) {
        let actions = app.buttons["outing.actions"]
        XCTAssertTrue(actions.existsOrWait(timeout: 5))
        actions.tap()
        app.buttons["outing.rename"].tap()
        XCTAssertTrue(app.textFields["outing.renameField"].existsOrWait(timeout: 5))
    }

    private func launchOutings(allowsUpdates: Bool) -> XCUIApplication {
        let app = application()
        app.launchArguments += ["--ui-test-fixture-populated", "--ui-test-ignore-shares"]
        if allowsUpdates { app.launchArguments.append("--ui-test-allow-outing-updates") }
        app.launch()
        waitForDataSetup(in: app)
        app.buttons["Outings"].tap()
        XCTAssertTrue(app.navigationBars["Outings"].existsOrWait(timeout: 5))
        return app
    }
}
