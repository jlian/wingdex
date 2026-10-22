import XCTest

@MainActor
final class AdaptiveToolbarUITests: BirdIdFlowUITestCase {
    func testSortAndSettingsRemainReachableAcrossTabs() {
        let app = application()
        app.launchArguments += [
            "--ui-test-fixture-populated", "--ui-test-ignore-shares",
            "--ui-test-registered-blank-name",
        ]
        app.launch()
        waitForDataSetup(in: app)
        for tab in ["WingDex", "Outings"] {
            app.buttons[tab].tap()
            let sort = app.buttons["Sort"]
            if !sort.exists {
                app.buttons["Show Sidebar"].tap()
            }
            XCTAssertTrue(sort.isHittable, app.debugDescription)
        }
        app.buttons["Settings"].tap()
        XCTAssertTrue(app.textFields["settings.displayName"].existsOrWait(timeout: 5))
    }
}
