import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private let titleLabel = UILabel()
    private let statusLabel = UILabel()
    private let progressView = UIProgressView(progressViewStyle: .default)
    private let openButton = UIButton(type: .system)
    private let cancelButton = UIButton(type: .system)
    private var stagingTask: Task<Void, Never>?
    private var providerProgresses: [Progress] = []

    override func viewDidLoad() {
        super.viewDidLoad()
        configureUI()
        stagingTask = Task { await stageSharedPhotos() }
    }

    deinit {
        stagingTask?.cancel()
        providerProgresses.forEach { $0.cancel() }
        providerProgresses = []
    }

    private func configureUI() {
        view.backgroundColor = .systemBackground

        titleLabel.text = "Share to WingDex"
        titleLabel.font = .preferredFont(forTextStyle: .title2)
        titleLabel.adjustsFontForContentSizeCategory = true
        titleLabel.textAlignment = .center

        statusLabel.text = "Preparing photos..."
        statusLabel.font = .preferredFont(forTextStyle: .body)
        statusLabel.adjustsFontForContentSizeCategory = true
        statusLabel.textColor = .secondaryLabel
        statusLabel.textAlignment = .center
        statusLabel.numberOfLines = 0

        openButton.configuration = .filled()
        openButton.configuration?.title = "Done"
        openButton.isHidden = true
        openButton.addTarget(self, action: #selector(finish), for: .touchUpInside)

        cancelButton.configuration = .plain()
        cancelButton.configuration?.title = "Cancel"
        cancelButton.addTarget(self, action: #selector(cancel), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [
            titleLabel,
            statusLabel,
            progressView,
            openButton,
            cancelButton,
        ])
        stack.axis = .vertical
        stack.spacing = 20
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            openButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 50),
        ])
    }

    @MainActor
    private func stageSharedPhotos() async {
        do {
            let providers = inputProviders().filter {
                $0.hasItemConformingToTypeIdentifier(UTType.image.identifier)
            }
            guard !providers.isEmpty else { throw IncomingShareError.noPhotos }
            guard providers.count <= IncomingShareStore.maximumPhotoCount else {
                throw IncomingShareError.tooManyPhotos
            }

            var temporaryFiles: [URL] = []
            defer {
                for url in temporaryFiles {
                    try? FileManager.default.removeItem(at: url)
                }
            }

            var totalBytes = 0
            for (index, provider) in providers.enumerated() {
                try Task.checkCancellation()
                let copy = try await copyTemporaryFile(
                    from: provider,
                    remainingBytes: IncomingShareStore.maximumTotalBytes - totalBytes
                )
                temporaryFiles.append(copy.url)
                totalBytes += copy.size
                progressView.progress = Float(index + 1) / Float(providers.count)
                statusLabel.text = "Preparing photo \(index + 1) of \(providers.count)..."
            }

            try Task.checkCancellation()
            try await stageInBackground(fileURLs: temporaryFiles)
            providerProgresses = []
            statusLabel.text = providers.count == 1
                ? "Your photo is ready. Open WingDex to identify it."
                : "Your \(providers.count) photos are ready. Open WingDex to identify them."
            progressView.isHidden = true
            openButton.isHidden = false
            cancelButton.isHidden = true
        } catch is CancellationError {
            return
        } catch {
            progressView.isHidden = true
            statusLabel.textColor = .systemRed
            statusLabel.text = error.localizedDescription
            cancelButton.configuration?.title = "Close"
        }
    }

    private func stageInBackground(fileURLs: [URL]) async throws {
        let stagingTask = Task.detached(priority: .userInitiated) {
            try await IncomingShareStore.stage(fileURLs: fileURLs)
        }
        try await withTaskCancellationHandler {
            try await stagingTask.value
        } onCancel: {
            stagingTask.cancel()
        }
    }

    private func inputProviders() -> [NSItemProvider] {
        (extensionContext?.inputItems as? [NSExtensionItem] ?? [])
            .flatMap { $0.attachments ?? [] }
    }

    private func copyTemporaryFile(
        from provider: NSItemProvider,
        remainingBytes: Int
    ) async throws -> (url: URL, size: Int) {
        try await withCheckedThrowingContinuation { continuation in
            let progress = provider.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { url, error in
                do {
                    if let error { throw error }
                    guard let url else { throw IncomingShareError.noPhotos }
                    guard let sourceBytes = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize,
                          sourceBytes >= 0
                    else { throw IncomingShareError.stagingFailed }
                    guard sourceBytes <= IncomingShareStore.maximumPhotoBytes else {
                        throw IncomingShareError.photoTooLarge
                    }
                    guard sourceBytes <= remainingBytes else {
                        throw IncomingShareError.shareTooLarge
                    }
                    let fileExtension = url.pathExtension.isEmpty ? "jpg" : url.pathExtension
                    let destination = FileManager.default.temporaryDirectory
                        .appendingPathComponent("wingdex-share-\(UUID().uuidString).\(fileExtension)")
                    try FileManager.default.copyItem(at: url, to: destination)
                    do {
                        guard let copiedBytes = try destination.resourceValues(forKeys: [.fileSizeKey]).fileSize,
                              copiedBytes >= 0
                        else { throw IncomingShareError.stagingFailed }
                        guard copiedBytes <= IncomingShareStore.maximumPhotoBytes else {
                            throw IncomingShareError.photoTooLarge
                        }
                        guard copiedBytes <= remainingBytes else {
                            throw IncomingShareError.shareTooLarge
                        }
                        continuation.resume(returning: (destination, copiedBytes))
                    } catch {
                        try? FileManager.default.removeItem(at: destination)
                        throw error
                    }
                } catch {
                    continuation.resume(throwing: error)
                }
            }
            if let progress = progress as Progress? {
                providerProgresses.append(progress)
            }
        }
    }

    @objc private func finish() {
        extensionContext?.completeRequest(returningItems: nil)
    }

    @objc private func cancel() {
        cancelInFlightWork()
        extensionContext?.cancelRequest(withError: CocoaError(.userCancelled))
    }

    private func cancelInFlightWork() {
        stagingTask?.cancel()
        stagingTask = nil
        providerProgresses.forEach { $0.cancel() }
        providerProgresses = []
    }
}