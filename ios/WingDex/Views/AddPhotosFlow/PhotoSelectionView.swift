import PhotosUI
import SwiftUI

/// Photo selection step in the Add Photos flow.
///
/// Offers both photo library picker and camera capture - the standard iOS
/// pattern for image input. Camera-captured photos feed into the same
/// extraction -> clustering -> identification pipeline as library photos.
struct PhotoSelectionView: View {
    @Bindable var viewModel: AddPhotosViewModel
    @State private var showCamera = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: 8) {
                Image(systemName: "camera.fill")
                    .font(.system(size: 44))
                    .foregroundStyle(Color.accentColor)
                    .padding(.bottom, 4)
                Text("Identify Birds")
                    .font(.system(.title2, design: .serif, weight: .semibold))
                    .foregroundStyle(Color.foregroundText)
                Text("Take a photo or choose from your library.\nClose-ups and side profiles work best.")
                    .font(.subheadline)
                    .foregroundStyle(Color.mutedText)
                    .multilineTextAlignment(.center)
            }

            Spacer().frame(height: 40)

            VStack(spacing: 12) {
                PhotosPicker(
                    selection: $viewModel.selectedItems,
                    maxSelectionCount: 50,
                    matching: .images
                ) {
                    Label("Choose from Library", systemImage: "photo.on.rectangle")
                        .font(.body.weight(.medium))
                        .frame(maxWidth: .infinity, minHeight: 50)
                }
                .buttonStyle(.borderedProminent)

                Button {
                    showCamera = true
                } label: {
                    Label("Take Photo", systemImage: "camera")
                        .font(.body.weight(.medium))
                        .frame(maxWidth: .infinity, minHeight: 50)
                }
                .buttonStyle(.bordered)
                .disabled(!UIImagePickerController.isSourceTypeAvailable(.camera))
            }
            .padding(.horizontal, 24)

            Spacer()
        }
        .background(Color.pageBg.ignoresSafeArea())
        .onChange(of: viewModel.selectedItems) {
            if !viewModel.selectedItems.isEmpty {
                Task { await viewModel.processSelectedPhotos() }
            }
        }
        .fullScreenCover(isPresented: $showCamera, onDismiss: {
            if !viewModel.cameraPhotos.isEmpty {
                Task { await viewModel.processSelectedPhotos() }
            }
        }) {
            CameraCaptureView { image in
                viewModel.addCameraPhoto(image)
            }
            .ignoresSafeArea()
        }
    }


}

// MARK: - Camera Capture View

/// UIKit camera wrapper for SwiftUI. Uses UIImagePickerController which is
/// the standard iOS camera interface with built-in photo capture UI.
struct CameraCaptureView: UIViewControllerRepresentable {
    let onCapture: (UIImage) -> Void
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
        let onCapture: (UIImage) -> Void
        let dismiss: DismissAction

        init(onCapture: @escaping (UIImage) -> Void, dismiss: DismissAction) {
            self.onCapture = onCapture
            self.dismiss = dismiss
        }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage {
                onCapture(image)
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
    NavigationStack {
        PhotoSelectionView(viewModel: AddPhotosViewModel())
    }
}
#endif
