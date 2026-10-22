import XCTest

@MainActor
final class ExternalLinkUITests: BirdIdFlowUITestCase {
    func testPhotoCreditHandoffPreservesReview() {
        let app = launchApp(extraArguments: [
            "--ui-test-geocoding-success", "--ui-test-stub-identification",
        ])
        waitForOutingReview(in: app).tap()
        let explore = app.buttons["Explore \(Self.expectedSpecies)"]
        XCTAssertTrue(explore.existsOrWait(timeout: 10))
        explore.tap()
        let credit = app.descendants(matching: .any)["speciesPeek.photoCredit"]
        XCTAssertTrue(scrollUntilVisible(credit, in: app))
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.terminate()
        credit.tap()
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 10))
        app.activate()
        XCTAssertTrue(credit.existsOrWait(timeout: 5))
        app.buttons["Done"].tap()
        XCTAssertTrue(explore.existsOrWait(timeout: 5))
        XCTAssertTrue(app.buttons["confirm.accept"].isEnabled)
        XCTAssertEqual(app.staticTexts["confirm.speciesName"].label, Self.expectedSpecies)
    }
}
