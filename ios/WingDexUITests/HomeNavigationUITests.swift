import XCTest

@MainActor
final class HomeNavigationUITests: BirdIdFlowUITestCase {
    func testRecentSpeciesSightingOpensOutingAndPreservesBackStack() {
        let app = application()
        app.launchArguments += ["--ui-test-fixture-populated", "--ui-test-ignore-shares"]
        app.launch()
        waitForDataSetup(in: app)

        for label in ["Open WingDex", "Open Outings"] {
            let heading = app.buttons[label]
            XCTAssertTrue(heading.existsOrWait(timeout: 5))
            XCTAssertGreaterThanOrEqual(heading.frame.height, 44)
        }

        let speciesName = "Chalk-browed Mockingbird"
        let outingName = "Parque Ibirapuera, Sao Paulo"
        let recentSpecies = app.descendants(matching: .any).matching(
            NSPredicate(format: "label == %@", speciesName)
        ).firstMatch

        for _ in 0..<2 {
            XCTAssertTrue(recentSpecies.existsOrWait(timeout: 5), app.debugDescription)
            recentSpecies.tap()
            XCTAssertTrue(app.navigationBars[speciesName].existsOrWait(timeout: 5))

            let sighting = app.buttons["species.sighting.ui-test-seeded-outing"]
            XCTAssertTrue(scrollUntilVisible(sighting, in: app), app.debugDescription)
            sighting.tap()
            XCTAssertTrue(app.navigationBars[outingName].existsOrWait(timeout: 5), app.debugDescription)

            app.buttons["BackButton"].tap()
            XCTAssertTrue(app.navigationBars[speciesName].existsOrWait(timeout: 5))
            app.buttons["BackButton"].tap()
            XCTAssertTrue(app.navigationBars["Home"].existsOrWait(timeout: 5))
        }
    }
}
