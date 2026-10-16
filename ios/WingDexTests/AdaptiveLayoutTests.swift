import SwiftUI
import XCTest

@testable import WingDex

final class AdaptiveLayoutTests: XCTestCase {
    private let wide = CGSize(width: 1_000, height: 700)
    private let tall = CGSize(width: 700, height: 1_000)
    private let bookFold = CGRect(x: 480, y: 0, width: 40, height: 700)
    private let tabletopFold = CGRect(x: 0, y: 480, width: 700, height: 40)

    func testFlatLayoutsPreserveCompactAndReadableFallbacks() {
        XCTAssertTrue(
            AdaptiveLayout.prefersPairedPanes(
                in: wide, sizeClass: .regular, dynamicTypeSize: .large
            ))
        XCTAssertFalse(
            AdaptiveLayout.prefersPairedPanes(
                in: tall, sizeClass: .regular, dynamicTypeSize: .large
            ))
        XCTAssertFalse(
            AdaptiveLayout.prefersPairedPanes(
                in: wide, sizeClass: .compact, dynamicTypeSize: .large
            ))
        XCTAssertFalse(
            AdaptiveLayout.prefersPairedPanes(
                in: wide, sizeClass: .regular, dynamicTypeSize: .accessibility3
            ))
    }

    func testTabletopFoldUsesPairedPanesInATallWindow() {
        XCTAssertTrue(
            AdaptiveLayout.prefersPairedPanes(
                in: tall, sizeClass: .regular, dynamicTypeSize: .large,
                divisionFrames: [tabletopFold]
            ))
    }

    func testActiveFoldKeepsAccessibilityControlsInTheirOwnPane() {
        XCTAssertTrue(
            AdaptiveLayout.prefersPairedPanes(
                in: tall, sizeClass: .regular, dynamicTypeSize: .accessibility3,
                divisionFrames: [tabletopFold]
            ))
    }

    func testFoldOutsideANavigationDetailDoesNotCreateExtraPanes() {
        XCTAssertFalse(
            AdaptiveLayout.prefersPairedPanes(
                in: CGSize(width: 500, height: 700), sizeClass: .regular,
                dynamicTypeSize: .large,
                divisionFrames: [CGRect(x: -40, y: 0, width: 40, height: 700)]
            ))
    }

    func testFlatContentRetainsItsWholeViewport() {
        XCTAssertEqual(
            AdaptiveLayout.displacedFrame(in: wide, avoiding: []),
            CGRect(origin: .zero, size: wide)
        )
    }

    func testBookControlsUseTheTrailingRegionWithoutCrossingTheFold() {
        let frame = AdaptiveLayout.displacedFrame(in: wide, avoiding: [bookFold])
        XCTAssertEqual(frame, CGRect(x: 520, y: 0, width: 480, height: 700))
        XCTAssertFalse(frame.intersects(bookFold))
    }

    func testBookControlsRespectRightToLeftLayout() {
        XCTAssertEqual(
            AdaptiveLayout.displacedFrame(
                in: wide, avoiding: [bookFold], layoutDirection: .rightToLeft
            ),
            CGRect(x: 0, y: 0, width: 480, height: 700)
        )
    }

    func testTabletopControlsUseTheStableLowerRegion() {
        let frame = AdaptiveLayout.displacedFrame(in: tall, avoiding: [tabletopFold])
        XCTAssertEqual(frame, CGRect(x: 0, y: 520, width: 700, height: 480))
        XCTAssertFalse(frame.intersects(tabletopFold))
    }

    func testTabletopProgressUsesTheVisibleUpperRegion() {
        XCTAssertEqual(
            AdaptiveLayout.displacedFrame(
                in: tall, avoiding: [tabletopFold], verticalPlacement: .top
            ),
            CGRect(x: 0, y: 0, width: 700, height: 480)
        )
    }

    func testDivisionAtTheEdgeDoesNotSqueezeContentIntoASliver() {
        XCTAssertEqual(
            AdaptiveLayout.displacedFrame(
                in: wide, avoiding: [CGRect(x: 950, y: 0, width: 40, height: 700)]
            ),
            CGRect(x: 0, y: 0, width: 950, height: 700)
        )
    }

    func testUnrelatedDivisionDoesNotMoveContent() {
        XCTAssertEqual(
            AdaptiveLayout.displacedFrame(
                in: wide, avoiding: [CGRect(x: 1_500, y: 0, width: 40, height: 700)]
            ),
            CGRect(origin: .zero, size: wide)
        )
    }

    func testTabletopDivisionAtTheBottomDoesNotSelectASliver() {
        XCTAssertEqual(
            AdaptiveLayout.displacedFrame(
                in: tall, avoiding: [CGRect(x: 0, y: 950, width: 700, height: 40)]
            ),
            CGRect(x: 0, y: 0, width: 700, height: 950)
        )
    }

    func testTabletopDivisionAtTheTopDoesNotSelectASliver() {
        XCTAssertEqual(
            AdaptiveLayout.displacedFrame(
                in: tall, avoiding: [CGRect(x: 0, y: 10, width: 700, height: 40)],
                verticalPlacement: .top
            ),
            CGRect(x: 0, y: 50, width: 700, height: 950)
        )
    }

    func testCollapsedViewportDoesNotProduceNegativeDimensions() {
        XCTAssertEqual(
            AdaptiveLayout.displacedFrame(in: .zero, avoiding: [bookFold]),
            .zero
        )
    }

    @MainActor
    func testDeletingOutingOnlyClearsItsOwnSplitViewSelection() {
        XCTAssertNil(OutingsView.selectionAfterDeleting("outing-a", currentSelection: "outing-a"))
        XCTAssertEqual(
            OutingsView.selectionAfterDeleting("outing-a", currentSelection: "outing-b"),
            "outing-b"
        )
        XCTAssertNil(OutingsView.selectionAfterDeleting("outing-a", currentSelection: nil))
    }
}
