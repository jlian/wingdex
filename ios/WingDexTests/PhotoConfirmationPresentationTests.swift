import XCTest
@testable import WingDex

@MainActor
final class PhotoConfirmationPresentationTests: XCTestCase {
    private func snapshot(
        _ requestID: UUID, loading: Bool, species: String = ""
    ) -> PhotoConfirmationPresentation.Snapshot {
        .init(
            key: .init(requestID: requestID, isIdentifying: loading),
            photo: .init(
                id: requestID.uuidString, originalURL: URL(fileURLWithPath: "/unused.jpg"),
                cleanupOriginal: false, thumbnail: Data(), exifTime: nil,
                gpsLat: nil, gpsLon: nil, fileHash: "", fileName: "", byteCount: 0
            ),
            candidates: species.isEmpty ? [] : [
                .init(species: species, confidence: 0.9, wikiTitle: nil, plumage: nil),
            ],
            location: nil, useGeoContext: false
        )
    }

    func testFastResultBypassesLoadingAtSwapBoundaryAndRetainsFadingSnapshot() {
        let presentation = PhotoConfirmationPresentation()
        let first = UUID()
        let second = UUID()
        presentation.update(snapshot(first, loading: false, species: "First"), reduceMotion: false)
        presentation.update(snapshot(second, loading: true), reduceMotion: false)
        XCTAssertEqual(presentation.phase, .fadingOut)
        XCTAssertEqual(presentation.displayed?.photo?.id, first.uuidString)
        presentation.update(snapshot(second, loading: false, species: "Second"), reduceMotion: false)
        XCTAssertEqual(presentation.displayed?.candidates.first?.species, "First")
        presentation.swapSnapshot()
        XCTAssertEqual(presentation.phase, .fadingIn)
        XCTAssertEqual(presentation.displayed?.key.isIdentifying, false)
        XCTAssertEqual(presentation.displayed?.photo?.id, second.uuidString)
        XCTAssertEqual(presentation.displayed?.candidates.first?.species, "Second")
        XCTAssertFalse(presentation.isCurrent)
        presentation.finishTransition()
        XCTAssertTrue(presentation.isCurrent)
    }

    func testSlowResultShowsDistinctLoadingUntilTheNextFadeSwap() {
        let presentation = PhotoConfirmationPresentation()
        let request = UUID()
        presentation.update(snapshot(UUID(), loading: false, species: "First"), reduceMotion: false)
        presentation.update(snapshot(request, loading: true), reduceMotion: false)
        presentation.swapSnapshot()
        XCTAssertEqual(presentation.displayed?.key.isIdentifying, true)
        presentation.update(snapshot(request, loading: false, species: "Result"), reduceMotion: false)
        XCTAssertEqual(presentation.displayed?.key.isIdentifying, true)
        XCTAssertEqual(presentation.phase, .fadingIn)
        presentation.finishTransition()
        XCTAssertEqual(presentation.phase, .fadingOut)
        XCTAssertEqual(presentation.displayed?.key.isIdentifying, true)
        presentation.swapSnapshot()
        XCTAssertEqual(presentation.displayed?.candidates.first?.species, "Result")
        XCTAssertEqual(presentation.displayed?.key.isIdentifying, false)
        presentation.finishTransition()
        XCTAssertTrue(presentation.isCurrent)
    }

    func testBackDuringFadeInQueuesLatestSnapshotWithoutMutatingDisplayedPage() {
        let presentation = PhotoConfirmationPresentation()
        let next = UUID()
        let back = UUID()
        presentation.update(snapshot(UUID(), loading: false, species: "First"), reduceMotion: false)
        presentation.update(snapshot(next, loading: true), reduceMotion: false)
        presentation.swapSnapshot()
        presentation.update(snapshot(back, loading: true), reduceMotion: false)
        presentation.update(snapshot(back, loading: false, species: "Previous"), reduceMotion: false)
        XCTAssertEqual(presentation.displayed?.key.requestID, next)
        presentation.finishTransition()
        XCTAssertEqual(presentation.phase, .fadingOut)
        presentation.swapSnapshot()
        XCTAssertEqual(presentation.displayed?.key.requestID, back)
        XCTAssertEqual(presentation.displayed?.candidates.first?.species, "Previous")
        presentation.finishTransition()
        XCTAssertTrue(presentation.isCurrent)
    }

    func testReduceMotionSwapsImmediatelyAndInvalidatesBothFadePhases() {
        for swapBeforeReducingMotion in [false, true] {
            let presentation = PhotoConfirmationPresentation()
            let request = UUID()
            presentation.update(snapshot(request, loading: true), reduceMotion: true)
            XCTAssertTrue(presentation.isCurrent)
            let result = snapshot(request, loading: false, species: "Result")
            presentation.update(result, reduceMotion: false)
            if swapBeforeReducingMotion { presentation.swapSnapshot() }
            presentation.update(result, reduceMotion: true)
            presentation.swapSnapshot()
            presentation.finishTransition()
            XCTAssertEqual(presentation.phase, .idle)
            XCTAssertEqual(presentation.displayed?.candidates.first?.species, "Result")
            XCTAssertTrue(presentation.isCurrent)
        }
    }
}
