import UIKit
import XCTest
@testable import WingDex

@MainActor
final class PhotoReviewCarouselTests: XCTestCase {
    func testAccessibilityActivationOpensPhotoOnce() {
        let cell = PhotoReviewCell(frame: .zero)
        var opened = 0
        cell.onAccessibilityActivate = { opened += 1 }

        XCTAssertTrue(cell.accessibilityActivate())
        XCTAssertEqual(opened, 1)
    }

    func testReuseClearsPhotoActivationAndRemovalActions() {
        let cell = PhotoReviewCell(frame: .zero)
        var opened = false
        cell.onAccessibilityActivate = { opened = true }
        cell.accessibilityCustomActions = [
            UIAccessibilityCustomAction(name: "Remove Photo") { _ in true },
        ]

        cell.prepareForReuse()

        XCTAssertFalse(cell.accessibilityActivate())
        XCTAssertFalse(opened)
        XCTAssertNil(cell.accessibilityCustomActions)
    }

    func testCellActivationAndTapOpenTheCorrespondingPhotoWithoutRemovingIt() throws {
        let photos = ["first", "second"].map { id in
            ProcessedPhoto(
                id: id, originalURL: URL(fileURLWithPath: "/unused/\(id).jpg"),
                cleanupOriginal: false, thumbnail: Data(), exifTime: nil,
                gpsLat: nil, gpsLon: nil, fileHash: id, fileName: "\(id).jpg", byteCount: 0
            )
        }
        var opened: [String] = []
        var removed: [String] = []
        let coordinator = PhotoReviewCarousel.Coordinator(
            photos: photos, onOpen: { opened.append($0.id) }, onRemove: { removed.append($0.id) }
        )
        let collection = UICollectionView(
            frame: CGRect(x: 0, y: 0, width: 320, height: 150),
            collectionViewLayout: UICollectionViewFlowLayout()
        )
        collection.register(PhotoReviewCell.self, forCellWithReuseIdentifier: "PhotoReviewCell")
        collection.dataSource = coordinator
        let index = IndexPath(item: 1, section: 0)
        collection.reloadData()
        collection.layoutIfNeeded()
        let cell = try XCTUnwrap(collection.cellForItem(at: index))

        XCTAssertEqual(cell.accessibilityLabel, "Photo 2 of 2")
        XCTAssertTrue(cell.accessibilityActivate())
        coordinator.collectionView(collection, didSelectItemAt: IndexPath(item: 0, section: 0))

        XCTAssertEqual(opened, ["second", "first"])
        XCTAssertTrue(removed.isEmpty)
        XCTAssertEqual(coordinator.photos.map(\.id), ["first", "second"])
    }

    func testReviewImageLoaderDecodesRAWFromFileURL() throws {
        let source = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures/synthetic-bayer.dng")

        let data = try XCTUnwrap(PhotoReviewImageLoader.loadData(at: source))
        let image = try XCTUnwrap(UIImage(data: data))

        XCTAssertEqual(max(image.size.width, image.size.height), 512)
        XCTAssertEqual(min(image.size.width, image.size.height), 384)
    }
}
