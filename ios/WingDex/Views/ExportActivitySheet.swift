import SwiftUI
import UIKit

extension View {
    func exportActivitySheet(item: Binding<ExportFileItem?>) -> some View {
        background {
            if let export = item.wrappedValue {
                ExportActivityPresenter(item: export) {
                    if item.wrappedValue?.id == export.id {
                        item.wrappedValue = nil
                    }
                }
                .id(export.id)
                .allowsHitTesting(false)
            }
        }
    }
}

private struct ExportActivityPresenter: UIViewControllerRepresentable {
    let item: ExportFileItem
    let onDismiss: () -> Void

    func makeUIViewController(context: Context) -> ExportActivityViewController {
        ExportActivityViewController(item: item, onDismiss: onDismiss)
    }

    func updateUIViewController(_ controller: ExportActivityViewController, context: Context) {}

    static func dismantleUIViewController(_ controller: ExportActivityViewController, coordinator: ()) {
        controller.tearDown()
    }
}

@MainActor
final class ExportActivityViewController: UIViewController, UIAdaptivePresentationControllerDelegate {
    private let item: ExportFileItem
    private var onDismiss: (() -> Void)?
    private var activityController: UIActivityViewController?
    private var finished = false

    init(item: ExportFileItem, onDismiss: @escaping () -> Void) {
        self.item = item
        self.onDismiss = onDismiss
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !finished, activityController == nil else { return }

        // Keep nested activities such as Messages in UIKit's presentation lifecycle,
        // without an additional SwiftUI sheet owning the activity controller.
        let activity = UIActivityViewController(activityItems: [item.url], applicationActivities: nil)
        activityController = activity
        activity.completionWithItemsHandler = { [weak self] _, _, _, _ in
            Task { @MainActor in self?.finish() }
        }
        if let popover = activity.popoverPresentationController {
            popover.sourceView = view
            popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        }
        activity.presentationController?.delegate = self
        present(activity, animated: true)
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        finish()
    }

    func tearDown() {
        onDismiss = nil
        if let activityController, activityController.presentingViewController != nil {
            activityController.dismiss(animated: false) { self.finish() }
        } else {
            finish()
        }
    }

    private func finish() {
        guard !finished else { return }
        finished = true
        item.cleanup()
        let completion = onDismiss
        onDismiss = nil
        completion?()
    }
}
