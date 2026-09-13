import SwiftUI
import UIKit
import os

final class PhotoReviewSheetImageCache: @unchecked Sendable {
    static let shared = PhotoReviewSheetImageCache()
    private let cache = NSCache<NSURL, UIImage>()

    init(totalCostLimit: Int = 96 * 1_024 * 1_024, countLimit: Int = 30) {
        cache.totalCostLimit = totalCostLimit
        cache.countLimit = countLimit
    }

    func image(for url: URL) -> UIImage? {
        cache.object(forKey: url as NSURL)
    }

    func setImage(_ image: UIImage, for url: URL) {
        cache.setObject(image, forKey: url as NSURL, cost: image.decodedByteCost)
    }
}

enum PhotoReviewImageLoader {
    static func cachedImage(for url: URL) -> UIImage? {
        PhotoReviewSheetImageCache.shared.image(for: url)
    }

    static func setCachedImage(_ image: UIImage, for url: URL) {
        PhotoReviewSheetImageCache.shared.setImage(image, for: url)
    }

    static func loadData(at url: URL) -> Data? {
        loadData(at: url, using: PhotoService.generateThumbnail)
    }

    static func loadData(
        at url: URL,
        using generateThumbnail: (URL, CGFloat) -> Data?
    ) -> Data? {
        generateThumbnail(url, 2_048)
    }
}

final class PhotoReviewThumbnailCache: @unchecked Sendable {
    static let shared = PhotoReviewThumbnailCache()
    private let cache = NSCache<NSData, UIImage>()

    init(totalCostLimit: Int = 32 * 1_024 * 1_024, countLimit: Int = 100) {
        cache.totalCostLimit = totalCostLimit
        cache.countLimit = countLimit
    }

    func image(for data: Data) -> UIImage? {
        cache.object(forKey: data as NSData)
    }

    func setImage(_ image: UIImage, for data: Data) {
        cache.setObject(image, forKey: data as NSData, cost: image.decodedByteCost)
    }
}

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
            let usesSuggestedCrop = photo.croppedImage == nil
            cell.configure(
                with: photo.thumbnail,
                focalPoint: usesSuggestedCrop ? photo.suggestedFocalPoint : nil,
                cropLogLabel: usesSuggestedCrop ? photo.id : nil
            )
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
    private let imageView = UIImageView()
    private let placeholderView = UIView()
    private let placeholderIcon = UIImageView()
    private var focalPoint = FocalCropGeometry.center
    private var cropLogLabel: String?

    override init(frame: CGRect) {
        super.init(frame: frame)
        setupViews()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        setupViews()
    }

    private func setupViews() {
        backgroundColor = .clear
        contentView.backgroundColor = .clear
        contentView.layer.cornerRadius = 8
        contentView.layer.cornerCurve = .continuous
        contentView.clipsToBounds = true

        placeholderView.backgroundColor = UIColor.secondaryLabel.withAlphaComponent(0.1)
        placeholderView.layer.cornerRadius = 8
        placeholderView.layer.cornerCurve = .continuous
        placeholderView.clipsToBounds = true
        placeholderView.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(placeholderView)

        placeholderIcon.image = UIImage(systemName: "photo")
        placeholderIcon.tintColor = .tertiaryLabel
        placeholderIcon.contentMode = .scaleAspectFit
        placeholderIcon.translatesAutoresizingMaskIntoConstraints = false
        placeholderView.addSubview(placeholderIcon)

        imageView.contentMode = .scaleToFill
        imageView.clipsToBounds = true
        contentView.addSubview(imageView)

        NSLayoutConstraint.activate([
            placeholderView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            placeholderView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            placeholderView.topAnchor.constraint(equalTo: contentView.topAnchor),
            placeholderView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),

            placeholderIcon.centerXAnchor.constraint(equalTo: placeholderView.centerXAnchor),
            placeholderIcon.centerYAnchor.constraint(equalTo: placeholderView.centerYAnchor),
            placeholderIcon.widthAnchor.constraint(equalToConstant: 32),
            placeholderIcon.heightAnchor.constraint(equalToConstant: 32),
        ])
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard let image = imageView.image else { return }
        imageView.frame = FocalCropGeometry.renderedFrame(
            imageSize: image.size,
            containerSize: contentView.bounds.size,
            focalPoint: focalPoint
        )
        if let cropLogLabel, contentView.bounds.width > 0, contentView.bounds.height > 0 {
            ImageLoader.shared.logCrop(
                image: image,
                focalPoint: focalPoint,
                containerSize: contentView.bounds.size,
                label: cropLogLabel
            )
            self.cropLogLabel = nil
        }
    }

    func configure(
        with thumbnailData: Data,
        focalPoint: CGPoint?,
        cropLogLabel: String?
    ) {
        self.focalPoint = focalPoint ?? FocalCropGeometry.center
        self.cropLogLabel = cropLogLabel
        if let cached = PhotoReviewThumbnailCache.shared.image(for: thumbnailData) {
            imageView.image = cached
            imageView.isHidden = false
            placeholderView.isHidden = true
        } else if let image = UIImage(data: thumbnailData) {
            PhotoReviewThumbnailCache.shared.setImage(image, for: thumbnailData)
            imageView.image = image
            imageView.isHidden = false
            placeholderView.isHidden = true
        } else {
            imageView.image = nil
            imageView.isHidden = true
            placeholderView.isHidden = false
        }
        setNeedsLayout()
    }

    override func accessibilityActivate() -> Bool {
        guard let onAccessibilityActivate else { return false }
        onAccessibilityActivate()
        return true
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        onAccessibilityActivate = nil
        accessibilityCustomActions = nil
        imageView.image = nil
        focalPoint = FocalCropGeometry.center
        cropLogLabel = nil
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
        PhotoReviewPager(photos: photos, selectedPhotoID: $selectedPhotoID)
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

private struct PhotoReviewPager: UIViewControllerRepresentable {
    let photos: [ProcessedPhoto]
    @Binding var selectedPhotoID: String

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIViewController(context: Context) -> UIPageViewController {
        let controller = UIPageViewController(transitionStyle: .scroll, navigationOrientation: .horizontal)
        controller.view.backgroundColor = .black
        controller.dataSource = context.coordinator
        controller.delegate = context.coordinator
        let index = photos.firstIndex { $0.id == selectedPhotoID } ?? 0
        if let page = context.coordinator.page(at: index) {
            controller.setViewControllers([page], direction: .forward, animated: false)
        }
        return controller
    }

    func updateUIViewController(_ controller: UIPageViewController, context: Context) {
        // UIKit owns the in-flight gesture. Updating the title must not reset its page controllers.
        context.coordinator.parent = self
    }

    final class Coordinator: NSObject, UIPageViewControllerDataSource, UIPageViewControllerDelegate {
        var parent: PhotoReviewPager

        init(parent: PhotoReviewPager) {
            self.parent = parent
        }

        func page(at index: Int) -> UIViewController? {
            guard parent.photos.indices.contains(index) else { return nil }
            let page = UIHostingController(rootView: PhotoReviewPage(
                photo: parent.photos[index],
                accessibilityLabel: "Photo \(index + 1) of \(parent.photos.count)"
            ))
            page.view.backgroundColor = .black
            page.view.clipsToBounds = true
            return page
        }

        private func index(of controller: UIViewController) -> Int? {
            guard let page = controller as? UIHostingController<PhotoReviewPage> else { return nil }
            return parent.photos.firstIndex { $0.id == page.rootView.photo.id }
        }

        func pageViewController(
            _ pageViewController: UIPageViewController, viewControllerBefore viewController: UIViewController
        ) -> UIViewController? {
            guard let index = index(of: viewController) else { return nil }
            return page(at: index - 1)
        }

        func pageViewController(
            _ pageViewController: UIPageViewController, viewControllerAfter viewController: UIViewController
        ) -> UIViewController? {
            guard let index = index(of: viewController) else { return nil }
            return page(at: index + 1)
        }

        func presentationCount(for pageViewController: UIPageViewController) -> Int {
            parent.photos.count > 1 ? parent.photos.count : 0
        }

        func presentationIndex(for pageViewController: UIPageViewController) -> Int {
            parent.photos.firstIndex { $0.id == parent.selectedPhotoID } ?? 0
        }

        func pageViewController(
            _ pageViewController: UIPageViewController, didFinishAnimating finished: Bool,
            previousViewControllers: [UIViewController], transitionCompleted completed: Bool
        ) {
            guard completed, let page = pageViewController.viewControllers?.first,
                  let index = index(of: page) else { return }
            parent.selectedPhotoID = parent.photos[index].id
        }
    }
}

private struct PhotoReviewPage: View {
    let photo: ProcessedPhoto
    let accessibilityLabel: String
    @State private var image: UIImage?
    @State private var failed = false
    private let log = Logger(subsystem: Config.bundleID, category: "PhotoReview")

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .accessibilityLabel(accessibilityLabel)
                    .accessibilityIdentifier("outing.photoPage.\(photo.id)")
            } else if failed {
                ContentUnavailableView("Could Not Open Photo", systemImage: "photo", description: Text("The original photo could not be read."))
            } else {
                ProgressView("Loading photo")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: photo.id) {
            if let cached = PhotoReviewImageLoader.cachedImage(for: photo.originalURL) {
                image = cached
                return
            }
            failed = false
            let url = photo.originalURL
            do {
                // Bound decoded memory for large originals, including adjacent swipe pages.
                let load = Task.detached(priority: .userInitiated) {
                    try Task.checkCancellation()
                    return PhotoReviewImageLoader.loadData(at: url)
                }
                let data = try await withTaskCancellationHandler {
                    try await load.value
                } onCancel: {
                    load.cancel()
                }
                try Task.checkCancellation()
                if let data, let decoded = UIImage(data: data) {
                    PhotoReviewImageLoader.setCachedImage(decoded, for: url)
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
    }
}
