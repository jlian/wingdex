@testable import WingDex
import CoreGraphics
import SwiftUI
import XCTest

final class PhotoComparisonLayoutTests: XCTestCase {
    func testCompactLayoutPreservesPhonePhotoSize() {
        XCTAssertEqual(
            PhotoComparisonLayout.photoSize(in: CGSize(width: 390, height: 700)),
            173
        )
    }

    func testExpandedLayoutUsesAdditionalWidth() {
        XCTAssertEqual(
            PhotoComparisonLayout.photoSize(in: CGSize(width: 900, height: 700)),
            350
        )
    }

    func testShortLayoutLeavesVerticalRoomForIdentification() {
        XCTAssertEqual(
            PhotoComparisonLayout.photoSize(in: CGSize(width: 900, height: 320)),
            160
        )
    }

    func testLargeWindowsKeepPhotosAtAUsefulMaximumSize() {
        XCTAssertEqual(
            PhotoComparisonLayout.photoSize(in: CGSize(width: 1_200, height: 1_000)),
            400
        )
    }

    func testCollapsedBoundsNeverProduceANegativeFrame() {
        for size in [CGSize.zero, CGSize(width: 20, height: 400), CGSize(width: 400, height: 0)] {
            XCTAssertEqual(PhotoComparisonLayout.photoSize(in: size), 0)
        }
    }

    func testTallMediaPaneStacksBothPhotosWithinTheViewport() {
        let pane = CGSize(width: 450, height: 604)
        let axis = PhotoComparisonLayout.comparisonAxis(in: pane)
        let size = PhotoComparisonLayout.photoSize(in: pane, axis: axis, captionHeight: 38)

        XCTAssertEqual(axis, .vertical)
        XCTAssertEqual(size, 258)
        XCTAssertEqual(size * 2 + 38 * 2 + PhotoComparisonLayout.spacing, pane.height)
        XCTAssertLessThanOrEqual(size + PhotoComparisonLayout.horizontalInset * 2, pane.width)
    }

    func testTabletopMediaPaneKeepsPhotosSideBySide() {
        let pane = CGSize(width: 800, height: 320)
        let axis = PhotoComparisonLayout.comparisonAxis(in: pane)
        let size = PhotoComparisonLayout.photoSize(in: pane, axis: axis, captionHeight: 38)

        XCTAssertEqual(axis, .horizontal)
        XCTAssertEqual(size, 282)
        XCTAssertEqual(size + 38, pane.height)
        XCTAssertLessThanOrEqual(
            size * 2 + PhotoComparisonLayout.spacing + PhotoComparisonLayout.horizontalInset * 2,
            pane.width
        )
    }

    func testStackedPhotosLeaveRoomForLargerCaptions() {
        let pane = CGSize(width: 450, height: 604)
        let size = PhotoComparisonLayout.photoSize(in: pane, axis: .vertical, captionHeight: 82)
        XCTAssertEqual(size, 214)
        XCTAssertEqual(size * 2 + 82 * 2 + PhotoComparisonLayout.spacing, pane.height)
    }

    func testMediaPanePhotosRespectMaximumSizeAndCollapsedBounds() {
        for axis in [Axis.horizontal, .vertical] {
            XCTAssertEqual(
                PhotoComparisonLayout.photoSize(
                    in: CGSize(width: 1_200, height: 1_200), axis: axis, captionHeight: 38
                ),
                400
            )
            for size in [CGSize.zero, CGSize(width: 20, height: 400), CGSize(width: 400, height: 0)] {
                XCTAssertEqual(
                    PhotoComparisonLayout.photoSize(in: size, axis: axis, captionHeight: 38), 0
                )
            }
        }
    }
}
