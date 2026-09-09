@testable import WingDex
import SwiftUI
import UIKit
import XCTest

@MainActor
final class ExportActivitySheetTests: XCTestCase {
    func testSwiftUIHostPresentsActivityAndClearsBindingOnCompletion() async throws {
        let item = try makeItem()
        defer { item.cleanup() }
        let state = ExportTestState(item: item)
        let host = UIHostingController(rootView: ExportTestView(state: state))
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let previousKeyWindow = scene.keyWindow
        let window = UIWindow(windowScene: scene)
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer {
            host.dismiss(animated: false)
            window.isHidden = true
            previousKeyWindow?.makeKey()
        }

        for _ in 0..<100 {
            if host.presentedViewController is UIActivityViewController { break }
            try await Task.sleep(for: .milliseconds(50))
        }
        let activity = try XCTUnwrap(host.presentedViewController as? UIActivityViewController)
        XCTAssertNil(activity.parent)
        XCTAssertTrue(FileManager.default.fileExists(atPath: item.url.path))
        let completion = try XCTUnwrap(activity.completionWithItemsHandler)
        completion(nil, false, nil, nil)
        for _ in 0..<100 {
            if state.item == nil && host.presentedViewController == nil { break }
            try await Task.sleep(for: .milliseconds(50))
        }
        XCTAssertNil(state.item)
        XCTAssertNil(host.presentedViewController)
        XCTAssertFalse(FileManager.default.fileExists(atPath: item.url.path))
    }

    func testDirectPresentationCompletesAndCancelsWithoutAnotherSheet() async throws {
        for completed in [false, true] {
            let item = try makeItem()
            defer { item.cleanup() }
            let dismissed = expectation(description: "Share state cleared")
            dismissed.assertForOverFulfill = true
            let presenter = ExportActivityViewController(item: item) { dismissed.fulfill() }
            let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
            let previousKeyWindow = scene.keyWindow
            let window = UIWindow(windowScene: scene)
            window.rootViewController = presenter
            window.makeKeyAndVisible()
            defer {
                presenter.tearDown()
                window.isHidden = true
                previousKeyWindow?.makeKey()
            }

            for _ in 0..<100 {
                if presenter.presentedViewController is UIActivityViewController { break }
                try await Task.sleep(for: .milliseconds(50))
            }
            let activity = try XCTUnwrap(presenter.presentedViewController as? UIActivityViewController)
            XCTAssertNil(activity.parent, "The activity must be presented, not embedded in a SwiftUI sheet")
            XCTAssertTrue(FileManager.default.fileExists(atPath: item.url.path))
            presenter.viewDidAppear(false)
            XCTAssertTrue(presenter.presentedViewController === activity, "Appearance must not present twice")

            let completion = try XCTUnwrap(activity.completionWithItemsHandler)
            completion(.message, completed, nil, nil)
            await fulfillment(of: [dismissed], timeout: 5)
            XCTAssertFalse(FileManager.default.fileExists(atPath: item.url.path))
            presenter.presentationControllerDidDismiss(try XCTUnwrap(activity.presentationController))
        }
    }

    func testInteractiveDismissalCleansUpAndClearsStateOnlyOnce() throws {
        let item = try makeItem()
        defer { item.cleanup() }
        var dismissals = 0
        let presenter = ExportActivityViewController(item: item) { dismissals += 1 }
        let presentation = UIPresentationController(presentedViewController: UIViewController(), presenting: presenter)

        presenter.presentationControllerDidDismiss(presentation)
        presenter.presentationControllerDidDismiss(presentation)
        presenter.tearDown()

        XCTAssertEqual(dismissals, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: item.url.path))
    }

    func testRemovalBeforePresentationCleansUpWithoutMutatingRemovedViewState() throws {
        let item = try makeItem()
        defer { item.cleanup() }
        var dismissals = 0
        let presenter = ExportActivityViewController(item: item) { dismissals += 1 }

        presenter.tearDown()
        presenter.tearDown()

        XCTAssertEqual(dismissals, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: item.url.path))
    }

    private func makeItem() throws -> ExportFileItem {
        let directory = try FileManager.default.url(
            for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        )
        return try ExportFileFactory.sightings(data: Data("Species,Count\nRobin,1\n".utf8), directory: directory)
    }
}

@MainActor
@Observable
private final class ExportTestState {
    var item: ExportFileItem?

    init(item: ExportFileItem) {
        self.item = item
    }
}

private struct ExportTestView: View {
    @Bindable var state: ExportTestState

    var body: some View {
        Color.clear.exportActivitySheet(item: $state.item)
    }
}
