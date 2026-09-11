import XCTest

/// All audits use local fixtures. The default structural checks do not resize
/// text or sample screenshots; the explicit deep lane adds those OS-sensitive
/// checks. Named activities retain screen-specific diagnostics.
@MainActor
final class PopulatedAccessibilityAuditUITests: BirdIdFlowUITestCase {
    func testMainScreensPassAccessibilityAudit() {
        continueAfterFailure = true
        let app = launchPopulatedApp()

        XCTContext.runActivity(named: "Home") { _ in
            guard app.buttons["Home"].existsOrWait(timeout: 10) else {
                XCTFail("Populated Home did not appear")
                return
            }
            do {
                try runAccessibilityAudit(
                    in: app,
                    for: .all.subtracting(.contrast),
                    handlingKnownIssue: isKnownHomeAuditIssue
                )
            } catch {
                XCTFail("Populated Home accessibility audit failed: \(error)")
            }
        }

        XCTContext.runActivity(named: "WingDex") { _ in
            app.buttons["WingDex"].tap()
            guard app.descendants(matching: .any)["Chalk-browed Mockingbird"]
                .existsOrWait(timeout: 10) else {
                XCTFail("Populated WingDex did not appear")
                return
            }
            do {
                try performListAccessibilityAudit(app: app, includesContrast: false)
            } catch {
                XCTFail("Populated WingDex accessibility audit failed: \(error)")
            }
        }

        XCTContext.runActivity(named: "Outings") { _ in
            app.buttons["Outings"].tap()
            guard app.navigationBars["Outings"].existsOrWait(timeout: 10) else {
                XCTFail("Populated Outings did not appear")
                return
            }
            do {
                try performListAccessibilityAudit(app: app, includesContrast: false)
            } catch {
                XCTFail("Populated Outings accessibility audit failed: \(error)")
            }
        }
    }

    private func launchPopulatedApp() -> XCUIApplication {
        let app = application()
        app.launchArguments += ["--ui-test-fixture-populated", "--ui-test-ignore-shares"]
        app.launch()
        waitForDataSetup(in: app)
        return app
    }
}

@MainActor
final class EmptyAccessibilityAuditUITests: BirdIdFlowUITestCase {
    func testMainScreensPassAccessibilityAudit() {
        continueAfterFailure = true
        let app = launchEmptyApp()

        XCTContext.runActivity(named: "Home") { _ in
            guard app.staticTexts["Got bird pics?"].existsOrWait(timeout: 10) else {
                XCTFail("Empty Home did not appear")
                return
            }
            do {
                try runAccessibilityAudit(in: app)
            } catch {
                XCTFail("Empty Home accessibility audit failed: \(error)")
            }
        }

        XCTContext.runActivity(named: "WingDex") { _ in
            app.buttons["WingDex"].tap()
            guard app.staticTexts["No Species Yet"].existsOrWait(timeout: 10) else {
                XCTFail("Empty WingDex did not appear")
                return
            }
            do {
                try performListAccessibilityAudit(app: app, includesContrast: true)
            } catch {
                XCTFail("Empty WingDex accessibility audit failed: \(error)")
            }
        }

        XCTContext.runActivity(named: "Outings") { _ in
            app.buttons["Outings"].tap()
            guard app.staticTexts["No Outings Yet"].existsOrWait(timeout: 10) else {
                XCTFail("Empty Outings did not appear")
                return
            }
            do {
                try performListAccessibilityAudit(app: app, includesContrast: true)
            } catch {
                XCTFail("Empty Outings accessibility audit failed: \(error)")
            }
        }
    }

    private func launchEmptyApp() -> XCUIApplication {
        let app = application()
        app.launchArguments += ["--ui-test-fixture-empty", "--ui-test-ignore-shares"]
        app.launch()
        waitForDataSetup(in: app)
        return app
    }
}

@MainActor
final class SettingsAccessibilityAuditUITests: BirdIdFlowUITestCase {
    func testSettingsAndDeletionConfirmationsPassAccessibilityAudit() throws {
        continueAfterFailure = true
        let app = launchSettingsApp()
        try runAccessibilityAudit(
            in: app,
            for: .all,
            handlingKnownIssue: isKnownSettingsAuditIssue
        )

        let deleteData = app.buttons["Delete Data..."]
        XCTAssertTrue(scrollUntilVisible(deleteData, in: app, maximumSwipes: 6))
        deleteData.tap()
        XCTAssertTrue(app.navigationBars["Data Management"].existsOrWait(timeout: 10))
        try runAccessibilityAudit(in: app)

        app.buttons["Delete All Data"].tap()
        XCTAssertTrue(app.alerts["Delete All Data?"].existsOrWait(timeout: 10))
        try runAccessibilityAudit(in: app, for: .all.subtracting(.dynamicType))
    }

    private func launchSettingsApp() -> XCUIApplication {
        let app = application()
        app.launchArguments += ["--ui-test-fixture-populated", "--ui-test-open-settings", "--ui-test-ignore-shares"]
        app.launch()
        waitForDataSetup(in: app)
        XCTAssertTrue(app.buttons["Done"].existsOrWait(timeout: 10))
        XCTAssertTrue(app.buttons["Shuffle Name"].existsOrWait(timeout: 10))
        return app
    }
}

@MainActor
final class SignInAccessibilityAuditUITests: BirdIdFlowUITestCase {
    func testSignInPassesAccessibilityAudit() throws {
        let app = application()
        app.launchArguments += [
            "--ui-test-sign-out",
            "--ui-test-share-store",
            "--ui-test-reset-share-store",
            "--ui-test-ignore-shares",
        ]
        app.launch()
        XCTAssertTrue(app.buttons["Log in"].existsOrWait(timeout: 30))
        app.buttons["Log in"].tap()
        XCTAssertTrue(app.buttons["Continue with Apple"].existsOrWait(timeout: 30))
        try runAccessibilityAudit(in: app, handlingKnownIssue: isKnownSignInAuditIssue)
    }
}

@MainActor
final class AddPhotosAccessibilityAuditUITests: BirdIdFlowUITestCase {
    // Keep full audits terminal. After a full audit of the active search field,
    // XCTest can spend 60s waiting for an animation before each next tap.
    // Fresh per-screen launches preserve every category without bypassing waits.
    func testPhotoReviewSheetPassesAccessibilityAudit() throws {
        continueAfterFailure = true
        let secondPhoto = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("WingDex/Resources/CollagePhotos/collage2.jpg")
        let app = launchApp(extraArguments: [
            "--ui-test-fixture-empty", "--ui-test-geocoding-success",
            "--ui-test-photo", secondPhoto.path,
        ])
        _ = waitForOutingReview(in: app)
        let thumbnail = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "outing.photo.")
        ).firstMatch
        XCTAssertTrue(scrollUntilVisible(thumbnail, in: app))
        thumbnail.tap()
        XCTAssertTrue(app.buttons["outing.photosClose"].existsOrWait(timeout: 5))
        let image = app.images.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "outing.photoPage.")
        ).firstMatch
        XCTAssertTrue(image.existsOrWait(timeout: 5))
        try runAccessibilityAudit(in: app)
    }

    func testOutingReviewPassesAccessibilityAudit() throws {
        let app = launchReview()
        try runAccessibilityAudit(in: app, handlingKnownIssue: isKnownAddPhotosAuditIssue)
    }

    func testLocationSearchPassesAccessibilityAudit() throws {
        let app = launchReview()
        _ = showPlaceSearch(in: app)
        try runAccessibilityAudit(in: app) {
            self.isKnownAddPhotosSearchAuditIssue($0, in: app)
        }
    }

    func testLocationMapPassesAccessibilityAudit() throws {
        let app = launchReview()
        showPlaceSearch(in: app).tap()
        XCTAssertTrue(app.searchFields.firstMatch.disappearsOrWait(timeout: 5))
        let preview = mapPreviewElement(in: app)
        XCTAssertTrue(scrollUntilVisible(preview, in: app))
        preview.tap()
        XCTAssertEqual(mapCoordinatesText(in: app), "(47.6573, -122.4066)")
        try runAccessibilityAudit(in: app, handlingKnownIssue: isKnownAddPhotosMapAuditIssue)
    }

    private func showPlaceSearch(in app: XCUIApplication) -> XCUIElement {
        openLocationPicker(in: app)
        setLocationQuery("Discovery", in: app)
        let result = app.buttons.matching(identifier: "outing.locationResult").firstMatch
        XCTAssertTrue(result.existsOrWait(timeout: 5))
        return result
    }

    private func launchReview() -> XCUIApplication {
        continueAfterFailure = true
        let app = launchApp(extraArguments: [
            "--ui-test-fixture-empty",
            "--ui-test-geocoding-failure",
            "--ui-test-place-search-result",
            "--ui-test-stub-identification",
        ])
        _ = waitForOutingReview(in: app)
        return app
    }
}
