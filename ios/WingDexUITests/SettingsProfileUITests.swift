import XCTest

@MainActor
final class SettingsProfileUITests: BirdIdFlowUITestCase {
    func testRegisteredAccountWithBlankNameKeepsProfileControls() {
        let app = application()
        app.launchArguments += [
            "--ui-test-fixture-populated", "--ui-test-open-settings",
            "--ui-test-ignore-shares", "--ui-test-registered-blank-name",
        ]
        app.launch()
        waitForDataSetup(in: app)

        let nameField = app.textFields["settings.displayName"]
        XCTAssertTrue(nameField.existsOrWait(timeout: 10))
        XCTAssertEqual(nameField.value as? String, "bird@example.com")
        XCTAssertFalse(app.staticTexts["Guest Account"].exists)
        XCTAssertTrue(app.buttons["Shuffle Name"].exists)
        XCTAssertTrue(app.buttons["Use 🦉 avatar"].exists)

        nameField.tap()
        nameField.typeText("Quiet Heron\n")
        XCTAssertEqual(nameField.value as? String, "Quiet Heron")
        XCTAssertFalse(app.staticTexts["Guest Account"].exists)
    }
}
