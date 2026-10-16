@testable import WingDex
import XCTest

final class PhotoSelectionLayoutTests: XCTestCase {
    func testPortraitCollageReachesTheControlsInsteadOfFadingAtMidScreen() {
        let fade = PhotoSelectionLayout.fadeRange(height: 1_100, controlsTop: 844)
        XCTAssertEqual(fade, 664...844)
        XCTAssertGreaterThan(fade.upperBound, 1_100 * 0.5)
    }

    func testLandscapeCollageAlsoFollowsTheControlGroup() {
        let fade = PhotoSelectionLayout.fadeRange(height: 700, controlsTop: 460)
        XCTAssertEqual(fade, 280...460)
        XCTAssertGreaterThan(fade.upperBound, 700 * 0.5)
    }

    func testTallControlsShortenTheFadeToKeepTextOnThePageBackground() {
        XCTAssertEqual(
            PhotoSelectionLayout.fadeRange(height: 700, controlsTop: 100),
            0...100
        )
    }

    func testUnmeasuredControlsHaveABoundedInitialFade() {
        XCTAssertEqual(
            PhotoSelectionLayout.fadeRange(height: 1_000, controlsTop: nil),
            470...650
        )
    }

    func testFadeStaysInsideCollapsedOrScrolledBounds() {
        XCTAssertEqual(PhotoSelectionLayout.fadeRange(height: 0, controlsTop: nil), 0...0)
        XCTAssertEqual(PhotoSelectionLayout.fadeRange(height: 100, controlsTop: -20), 0...0)
        XCTAssertEqual(PhotoSelectionLayout.fadeRange(height: 100, controlsTop: 200), 70...100)
    }
}
