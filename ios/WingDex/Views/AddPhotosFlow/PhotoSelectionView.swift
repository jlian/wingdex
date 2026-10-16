import PhotosUI
import SwiftUI

// MARK: - Collage Tuning Parameters

/// Size of each photo tile in points
private let collageTileSize: CGFloat = 130
/// Gap between tiles
private let collageSpacing: CGFloat = 5
/// Rotation angle in degrees (negative = counter-clockwise)
private let collageAngle: Double = -15
/// Number of horizontal rows of photos
private let collageRows = 8
/// Corner radius of each tile
private let collageCornerRadius: CGFloat = 10
/// Photo opacity (0 = invisible, 1 = full brightness)
private let collageOpacity: Double = 1

/// Where the top blur finishes fading out (fraction of screen, 0 = no top blur)
private let collageTopBlurFadeEnd: CGFloat = 0.05

enum PhotoSelectionLayout {
    static func fadeRange(height: CGFloat, controlsTop: CGFloat?) -> ClosedRange<CGFloat> {
        let height = max(0, height)
        let end = min(max(controlsTop ?? height * 0.65, 0), height)
        return max(0, end - min(180, height * 0.3))...end
    }
}

// MARK: - Photo Selection View

/// Photo selection step in the Add Photos flow.
///
/// Offers both photo library picker and camera capture - the standard iOS
/// pattern for image input. Camera-captured photos feed into the same
/// extraction -> clustering -> identification pipeline as library photos.
struct PhotoSelectionView: View {
    @Environment(AppNavigationModel.self) private var navigation
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage(CameraPhotoSaver.preferenceKey) private var saveCameraPhotos = true
    @Bindable var viewModel: AddPhotosViewModel
    @State private var showLibrary = false
    @State private var showCamera = false
    @State private var showCameraUnavailable = false
    @State private var collageDrag: CGSize = .zero
    @State private var controlsTop: CGFloat?
    @State private var collageCache = CollageImageCache.shared
    @StateObject private var locationService = LocationService()
    @State private var cameraPhotoSaver = CameraPhotoSaver()

    var body: some View {
        GeometryReader { geo in
            let divisions = AdaptiveLayout.activeDivisionFrames(in: geo)
            ZStack {
                Color.pageBg.ignoresSafeArea()

                if divisions.isEmpty {
                    photoCollage.ignoresSafeArea()

                    Rectangle()
                        .fill(.ultraThinMaterial)
                        .mask(collageMask(height: geo.size.height))
                        .ignoresSafeArea()

                    Color.pageBg
                        .mask(collageMask(height: geo.size.height))
                        .ignoresSafeArea()

                    selectionContent(in: geo.size, centered: false)
                } else {
                    AdaptiveColumns {
                        photoCollage
                            .mask(LinearGradient(
                                stops: [
                                    .init(color: .clear, location: 0),
                                    .init(color: .black, location: 0.06),
                                    .init(color: .black, location: 0.9),
                                    .init(color: .clear, location: 1),
                                ],
                                startPoint: .top, endPoint: .bottom
                            ))
                            .clipped()
                    } secondary: {
                        GeometryReader { pane in
                            selectionContent(in: pane.size, centered: true)
                        }
                    }
                }
            }
            .coordinateSpace(name: "photoSelection")
            .contentShape(Rectangle())
            .simultaneousGesture(
                DragGesture()
                    .onChanged { value in
                        guard !reduceMotion else { return }
                        // Rubber-band function: maps unbounded input to bounded output.
                        let rubberBand = { (v: CGFloat, limit: CGFloat, resistance: CGFloat) -> CGFloat in
                            limit * tanh(v / (limit * resistance))
                        }
                        let limit: CGFloat = 60
                        let resistance: CGFloat = 16
                        collageDrag = CGSize(
                            width: rubberBand(value.translation.width, limit, resistance),
                            height: rubberBand(value.translation.height, limit, resistance)
                        )
                    }
                    .onEnded { _ in
                        withAnimation(.spring(response: 0.4, dampingFraction: 0.6)) {
                            collageDrag = .zero
                        }
                    }
            )
            .toolbar(.hidden, for: .navigationBar)
        }
        .task { await collageCache.load() }
        .onChange(of: reduceMotion) {
            if reduceMotion { collageDrag = .zero }
        }
        .onChange(of: viewModel.selectedItems) {
            if !viewModel.selectedItems.isEmpty {
                Task { await viewModel.processSelectedPhotos() }
            }
        }
        .photosPicker(
            isPresented: $showLibrary,
            selection: $viewModel.selectedItems,
            matching: .images,
            preferredItemEncoding: .current
        )
        .task(id: navigation.addPhotosLaunchRequest?.id) {
            guard let request = navigation.addPhotosLaunchRequest else { return }
            navigation.consumeAddPhotosLaunchRequest(id: request.id)
            switch request.action {
            case .library:
                showLibrary = true
            case .camera:
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    openCamera()
                } else {
                    showCameraUnavailable = true
                }
            }
        }
        .alert("Camera Unavailable", isPresented: $showCameraUnavailable) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("This device does not have an available camera.")
        }
        .fullScreenCover(isPresented: $showCamera, onDismiss: {
            locationService.stop()
            let captures = viewModel.cameraPhotos
            let shouldSave = saveCameraPhotos
            for capture in captures {
                Task {
                    do {
                        _ = try await cameraPhotoSaver.save(capture, enabled: shouldSave)
                    } catch ImageSharingError.photoLibraryAccessDenied {
                        toasts.showError("Photo not saved to Photos. Enable Photos access in Settings. You can still identify it.")
                    } catch {
                        toasts.showError("Photo could not be saved to Photos. You can still identify it.")
                    }
                }
            }
            if !viewModel.cameraPhotos.isEmpty {
                Task { await viewModel.processSelectedPhotos() }
            }
        }) {
            CameraCaptureView { image, metadata in
                let coord = locationService.latestCoordinate
                do {
                    let capture = try CameraCapture.make(
                        image: image, metadata: metadata, latitude: coord?.lat, longitude: coord?.lon
                    )
                    viewModel.addCameraPhoto(capture)
                } catch {
                    toasts.showError(error.localizedDescription)
                }
            }
            .ignoresSafeArea()
        }
    }

    private var photoCollage: some View {
        DiagonalPhotoCollage(imageNames: CollageImageCache.names, images: collageCache.images)
            .offset(collageDrag)
            .opacity(dynamicTypeSize.isAccessibilitySize ? 0.12 : 1)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    private func collageMask(height: CGFloat) -> some View {
        let fade = PhotoSelectionLayout.fadeRange(height: height, controlsTop: controlsTop)
        let height = max(1, height)
        return LinearGradient(
            stops: [
                .init(color: .black, location: 0),
                .init(color: .clear, location: min(collageTopBlurFadeEnd, fade.lowerBound / height)),
                .init(color: .clear, location: fade.lowerBound / height),
                .init(color: .black, location: fade.upperBound / height),
                .init(color: .black, location: 1),
            ],
            startPoint: .top, endPoint: .bottom
        )
    }

    private func selectionContent(in size: CGSize, centered: Bool) -> some View {
        ScrollView {
            VStack(spacing: 0) {
                Spacer(minLength: 24)
                selectionControls
                    .onGeometryChange(for: CGFloat.self) { geometry in
                        geometry.frame(in: .named("photoSelection")).minY
                    } action: { controlsTop = $0 }
                if centered {
                    Spacer(minLength: 24)
                } else {
                    Spacer().frame(height: 24)
                }
            }
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity, minHeight: size.height)
        }
        .scrollBounceBehavior(.basedOnSize)
    }

    private var selectionControls: some View {
        VStack(spacing: 28) {
            VStack(spacing: 6) {
                Text("Identify Birds")
                    .font(.system(.title, design: .serif, weight: .semibold))
                    .foregroundStyle(Color.foregroundText)
                Text("One bird per photo for accuracy\nClose-ups and side profiles work best")
                    .font(.subheadline)
                    .foregroundStyle(Color.mutedText)
                    .multilineTextAlignment(.center)
            }

            VStack(spacing: 12) {
                Button {
                    showLibrary = true
                } label: {
                    Label("Choose from Library", systemImage: "photo.on.rectangle")
                        .font(.body.weight(.medium))
                        .frame(maxWidth: .infinity, minHeight: 50)
                }
                .buttonStyle(.glassProminent)
                .buttonSizing(.flexible)

                Button {
                    openCamera()
                } label: {
                    Label("Take Photo", systemImage: "camera")
                        .font(.body.weight(.medium))
                        .frame(maxWidth: .infinity, minHeight: 50)
                }
                .buttonStyle(.glass)
                .buttonSizing(.flexible)
                .disabled(!UIImagePickerController.isSourceTypeAvailable(.camera))
            }
            .padding(.horizontal, 24)
        }
    }

    private func openCamera() {
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            showCameraUnavailable = true
            return
        }
        locationService.start()
        showCamera = true
    }

}

// MARK: - Diagonal Photo Collage

/// Netflix-style diagonal scrolling photo grid background.
private struct DiagonalPhotoCollage: View {
    let imageNames: [String]
    let images: [String: UIImage]

    var body: some View {
        if imageNames.isEmpty { Color.clear } else {
        GeometryReader { geo in
            let pitch = collageTileSize + collageSpacing
            let extraWidth = geo.size.height * abs(sin(collageAngle * .pi / 180))
            let tilesPerRow = Int((geo.size.width + extraWidth) / pitch) + 2

            VStack(spacing: collageSpacing) {
                ForEach(0..<collageRows, id: \.self) { row in
                    HStack(spacing: collageSpacing) {
                        if !row.isMultiple(of: 2) {
                            Spacer().frame(width: pitch, height: collageTileSize)
                        }
                        ForEach(0..<tilesPerRow, id: \.self) { col in
                            let index = (row * tilesPerRow + col) % imageNames.count
                            let name = imageNames[index]
                            if let img = images[name] {
                                Image(uiImage: img)
                                    .resizable()
                                    .scaledToFill()
                                    .frame(width: collageTileSize, height: collageTileSize)
                                    .clipShape(RoundedRectangle(cornerRadius: collageCornerRadius))
                            } else {
                                Color.warmBorder.opacity(0.15)
                                    .frame(width: collageTileSize, height: collageTileSize)
                                    .clipShape(RoundedRectangle(cornerRadius: collageCornerRadius))
                            }
                        }
                    }
                }
            }
            .drawingGroup()
            .frame(width: geo.size.width + extraWidth)
            .rotationEffect(.degrees(collageAngle))
            .offset(x: -extraWidth / 2, y: -pitch)
            .opacity(collageOpacity)
        }
        }
    }
}

// MARK: - Camera Capture View

/// UIKit camera wrapper for SwiftUI. Uses UIImagePickerController which is
/// the standard iOS camera interface with built-in photo capture UI.
struct CameraCaptureView: UIViewControllerRepresentable {
    let onCapture: (UIImage, [String: Any]) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onCapture: onCapture, dismiss: dismiss)
    }

    class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onCapture: (UIImage, [String: Any]) -> Void
        let dismiss: DismissAction

        init(onCapture: @escaping (UIImage, [String: Any]) -> Void, dismiss: DismissAction) {
            self.onCapture = onCapture
            self.dismiss = dismiss
        }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage {
                onCapture(image, info[.mediaMetadata] as? [String: Any] ?? [:])
            }
            dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            dismiss()
        }
    }
}

// MARK: - Previews

#if DEBUG
#Preview {
    PreviewTabs(.add) {
        NavigationStack {
            PhotoSelectionView(viewModel: AddPhotosViewModel())
        }
    }
}
#endif
