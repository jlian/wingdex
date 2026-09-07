import XCTest

@MainActor
final class CameraSettingsUITests: BirdIdFlowUITestCase {
    func testCameraPreferencePersistsWithoutPromptingForPermission() {
        let app = application()
        app.launchArguments += ["--ui-test-fixture-populated", "--ui-test-open-settings", "--ui-test-ignore-shares"]
        app.launch()
        waitForDataSetup(in: app)
        let setting = cameraSetting(in: app)
        let previousValue = setting.value as? String
        setting.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
        let updatedValue = setting.value as? String
        XCTAssertNotEqual(updatedValue, previousValue)
        XCTAssertFalse(app.alerts.firstMatch.exists)
        app.terminate()
        app.launch()
        waitForDataSetup(in: app)
        let restoredSetting = cameraSetting(in: app)
        XCTAssertEqual(restoredSetting.value as? String, updatedValue)
        restoredSetting.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
        XCTAssertEqual(restoredSetting.value as? String, previousValue)
    }

    private func cameraSetting(in app: XCUIApplication) -> XCUIElement {
        let setting = app.switches["settings.saveCameraPhotos"]
        for _ in 0..<6 {
            if setting.exists && setting.isHittable { return setting }
            app.swipeUp()
        }
        XCTAssertTrue(setting.exists && setting.isHittable)
        return setting
    }
}
