import SwiftUI
import UIKit
import os

struct PhotoReviewCarousel: UIViewRepresentable {
    let photos: [ProcessedPhoto]
    let onOpen: (ProcessedPhoto) -> Void
    let onRemove: (ProcessedPhoto) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(photos: photos, onOpen: onOpen, onRemove: onRemove)
    }

    func makeUIView(context: Context) -> UICollectionView {
        let layout = UICollectionViewFlowLayout()
        layout.scrollDirection = .horizontal
        layout.minimumLineSpacing = 8
        layout.minimumInteritemSpacing = 8
        layout.itemSize = CGSize(width: 150, height: 150)

        let collectionView = UICollectionView(frame: .zero, collectionViewLayout: layout)
        collectionView.backgroundColor = .clear
        collectionView.showsHorizontalScrollIndicator = false
        collectionView.alwaysBounceHorizontal = true
        collectionView.delaysContentTouches = false
        collectionView.canCancelContentTouches = true
        collectionView.register(PhotoReviewCell.self, forCellWithReuseIdentifier: "PhotoReviewCell")
        collectionView.dataSource = context.coordinator
        collectionView.delegate = context.coordinator
        return collectionView
    }

    func updateUIView(_ collectionView: UICollectionView, context: Context) {
        let oldIDs = context.coordinator.photos.map(\.id)
        context.coordinator.photos = photos
        context.coordinator.onOpen = onOpen
        context.coordinator.onRemove = onRemove
        if oldIDs != photos.map(\.id) { collectionView.reloadData() }
    }

    @MainActor
    final class Coordinator: NSObject, UICollectionViewDataSource, UICollectionViewDelegate {
        var photos: [ProcessedPhoto]
        var onOpen: (ProcessedPhoto) -> Void
        var onRemove: (ProcessedPhoto) -> Void

        init(photos: [ProcessedPhoto], onOpen: @escaping (ProcessedPhoto) -> Void, onRemove: @escaping (ProcessedPhoto) -> Void) {
            self.photos = photos
            self.onOpen = onOpen
            self.onRemove = onRemove
        }

        func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int {
            photos.count
        }

        func collectionView(
            _ collectionView: UICollectionView,
            cellForItemAt indexPath: IndexPath
        ) -> UICollectionViewCell {
            guard let cell = collectionView.dequeueReusableCell(withReuseIdentifier: "PhotoReviewCell", for: indexPath) as? PhotoReviewCell else {
                preconditionFailure("Unexpected photo review cell type")
            }
            let photo = photos[indexPath.item]
            cell.contentConfiguration = UIHostingConfiguration {
                PhotoReviewThumbnail(data: photo.thumbnail)
            }
            .margins(.all, 0)
            cell.backgroundColor = .clear
            cell.contentView.backgroundColor = .clear
            cell.isAccessibilityElement = true
            cell.accessibilityLabel = "Photo \(indexPath.item + 1) of \(photos.count)"
            cell.accessibilityIdentifier = "outing.photo.\(photo.id)"
            cell.accessibilityHint = "Opens photo viewer. Swipe to browse all photos."
            cell.accessibilityTraits = [.image, .button]
            cell.onAccessibilityActivate = { [weak self] in self?.onOpen(photo) }
            cell.accessibilityCustomActions = [
                UIAccessibilityCustomAction(name: "Remove Photo") { [weak self] _ in
                    self?.onRemove(photo)
                    return true
                },
            ]
            return cell
        }

        func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
            collectionView.deselectItem(at: indexPath, animated: false)
            onOpen(photos[indexPath.item])
        }

        func collectionView(
            _ collectionView: UICollectionView,
            contextMenuConfigurationForItemAt indexPath: IndexPath,
            point: CGPoint
        ) -> UIContextMenuConfiguration? {
            let photo = photos[indexPath.item]
            return UIContextMenuConfiguration(
                identifier: photo.id as NSString,
                previewProvider: {
                    guard let image = UIImage(contentsOfFile: photo.originalURL.path) else { return nil }
                    let size = Self.previewSize(for: image)
                    let controller = UIHostingController(
                        rootView: Image(uiImage: image)
                            .resizable()
                            .scaledToFit()
                            .frame(width: size.width, height: size.height)
                            .clipped()
                    )
                    controller.view.backgroundColor = .clear
                    controller.preferredContentSize = size
                    return controller
                },
                actionProvider: { [weak self] _ in
                    UIMenu(children: [
                        UIAction(
                            title: "Remove Photo",
                            image: UIImage(systemName: "trash"),
                            attributes: .destructive
                        ) { _ in self?.onRemove(photo) },
                    ])
                }
            )
        }

        func collectionView(
            _ collectionView: UICollectionView,
            previewForHighlightingContextMenuWithConfiguration configuration: UIContextMenuConfiguration
        ) -> UITargetedPreview? {
            targetedPreview(for: configuration, in: collectionView)
        }

        func collectionView(
            _ collectionView: UICollectionView,
            previewForDismissingContextMenuWithConfiguration configuration: UIContextMenuConfiguration
        ) -> UITargetedPreview? {
            targetedPreview(for: configuration, in: collectionView)
        }

        private func targetedPreview(
            for configuration: UIContextMenuConfiguration,
            in collectionView: UICollectionView
        ) -> UITargetedPreview? {
            guard let id = configuration.identifier as? String,
                  let index = photos.firstIndex(where: { $0.id == id }),
                  let cell = collectionView.cellForItem(at: IndexPath(item: index, section: 0))
            else { return nil }
            let parameters = UIPreviewParameters()
            parameters.backgroundColor = .clear
            parameters.visiblePath = UIBezierPath(roundedRect: cell.bounds, cornerRadius: 8)
            return UITargetedPreview(view: cell, parameters: parameters)
        }

        private static func previewSize(for image: UIImage) -> CGSize {
            let maxWidth: CGFloat = 360
            let maxHeight: CGFloat = 560
            let aspect = max(image.size.width, 1) / max(image.size.height, 1)
            var width = maxWidth
            var height = width / aspect
            if height > maxHeight {
                height = maxHeight
                width = height * aspect
            }
            return CGSize(width: max(180, width), height: max(180, height))
        }
    }
}

@MainActor
final class PhotoReviewCell: UICollectionViewCell {
    var onAccessibilityActivate: (() -> Void)?

    override func accessibilityActivate() -> Bool {
        guard let onAccessibilityActivate else { return false }
        onAccessibilityActivate()
        return true
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        onAccessibilityActivate = nil
        accessibilityCustomActions = nil
    }
}

struct PhotoReviewSheet: View {
    let photos: [ProcessedPhoto]
    @Environment(\.dismiss) private var dismiss
    @State private var selectedPhotoID: String

    init(photos: [ProcessedPhoto], selectedPhotoID: String) {
        self.photos = photos
        _selectedPhotoID = State(initialValue: selectedPhotoID)
    }

    private var title: String {
        guard let index = photos.firstIndex(where: { $0.id == selectedPhotoID }) else { return "Photos" }
        return "Photo \(index + 1) of \(photos.count)"
    }

    var body: some View {
        TabView(selection: $selectedPhotoID) {
            ForEach(photos) { photo in
                PhotoReviewPage(photo: photo)
                    .padding(.bottom, photos.count > 1 ? 36 : 0)
                    .tag(photo.id)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: photos.count > 1 ? .always : .never))
        .background(.black)
        .preferredColorScheme(.dark)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Close", systemImage: "xmark") { dismiss() }
                    .labelStyle(.iconOnly)
                    .accessibilityIdentifier("outing.photosClose")
            }
        }
    }
}

private struct PhotoReviewPage: View {
    let photo: ProcessedPhoto
    @State private var image: UIImage?
    @State private var failed = false
    private let log = Logger(subsystem: Config.bundleID, category: "PhotoReview")

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .accessibilityLabel(photo.fileName)
                    .accessibilityIdentifier("outing.photoPage.\(photo.id)")
            } else if failed {
                ContentUnavailableView("Could Not Open Photo", systemImage: "photo", description: Text("The original photo could not be read."))
            } else {
                ProgressView("Loading photo")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: photo.id) {
            failed = false
            let url = photo.originalURL
            do {
                // Bound decoded memory for large originals, including adjacent swipe pages.
                let load = Task.detached(priority: .userInitiated) {
                    try Task.checkCancellation()
                    let original = try Data(contentsOf: url, options: .mappedIfSafe)
                    try Task.checkCancellation()
                    return PhotoService.generateThumbnail(from: original, maxDimension: 2048)
                }
                let data = try await withTaskCancellationHandler {
                    try await load.value
                } onCancel: {
                    load.cancel()
                }
                try Task.checkCancellation()
                if let data, let decoded = UIImage(data: data) {
                    image = decoded
                } else {
                    failed = true
                    log.error("Could not decode photo for review")
                }
            } catch is CancellationError {
                return
            } catch {
                failed = true
                log.error("Could not load photo for review: \(error.localizedDescription)")
            }
        }
        .onDisappear { image = nil }
    }
}

private struct PhotoReviewThumbnail: View {
    let data: Data

    var body: some View {
        Group {
            if let image = UIImage(data: data) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.secondary.opacity(0.1))
                    .overlay {
                        Image(systemName: "photo")
                            .foregroundStyle(.tertiary)
                    }
            }
        }
        .frame(width: 150, height: 150)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}
