@testable import WingDex
import XCTest

@MainActor
final class UITestDataServiceTests: XCTestCase {
    func testSuccessfulUploadRefreshesListingsAndDrainsRealPendingQueue() async throws {
        let service = UITestDataService(mode: .empty, allowsPhotoUploads: true)
        let queue = try PendingUploadStore(isStoredInMemoryOnly: true)
        let store = DataStore(service: service, pendingUploadStore: queue)
        store.activate(accountID: "ui-test-account")
        await store.loadAll()
        let draft = Outing(
            id: "saved-outing", userId: "",
            startTime: "2026-02-12T06:58:00Z", endTime: "2026-02-12T07:58:00Z",
            locationName: "Carkeek Park", notes: "", createdAt: "2026-02-12T06:58:00Z"
        )
        let outing = Outing(
            id: "saved-outing", userId: "ui-test-account",
            startTime: "2026-02-12T06:58:00Z", endTime: "2026-02-12T07:58:00Z",
            locationName: "Carkeek Park", notes: "", createdAt: "2026-02-12T06:58:00Z"
        )
        let upload = PendingPhotoUpload(
            id: "upload", accountID: outing.userId, createdAt: .now, locationName: outing.locationName,
            outing: draft, outingRecoverySnapshot: nil,
            photos: [.init(
                id: "photo", outingId: outing.id, exifTime: nil, gps: nil,
                fileHash: "hash", fileName: "photo.jpg"
            )],
            observations: [.init(
                id: "observation", outingId: outing.id, speciesName: "Great Blue Heron",
                count: 1, certainty: .confirmed, notes: ""
            )]
        )
        for _ in 0..<2 {
            let result = try await store.savePhotoUpload(upload)
            guard case .synced = result else {
                return XCTFail("Fixture upload must sync, not merely remain queued")
            }
            XCTAssertEqual(store.pendingUploadCount, 0)
            XCTAssertEqual(store.outings, [outing])
            XCTAssertEqual(store.photos.map(\.id), ["photo"])
            XCTAssertEqual(store.observations.map(\.id), ["observation"])
            XCTAssertEqual(store.dex.map(\.speciesName), ["Great Blue Heron"])
            XCTAssertEqual(store.dex.first?.totalCount, 1)
        }
    }

    func testOutingEditSurvivesFixtureRefresh() async throws {
        let service = UITestDataService(mode: .populated, allowsOutingUpdates: true)
        _ = try await service.updateOuting(id: "ui-test-seeded-outing", fields: OutingUpdate(notes: "Edited notes"))
        let refreshed = try await service.fetchAllData()
        XCTAssertEqual(refreshed.outings.first { $0.id == "ui-test-seeded-outing" }?.notes, "Edited notes")
    }
}
