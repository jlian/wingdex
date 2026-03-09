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
        VStack(spacing: 20) {
            Spacer()

            Image(systemName: "camera.fill")
                .font(.system(size: 40))
                .foregroundStyle(Color.accentColor)

            VStack(spacing: 6) {
                Text("Add Photos")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(Color.foregroundText)
                Text("Take or choose bird photos to identify.")
                    .font(.subheadline)
                    .foregroundStyle(Color.mutedText)
            }

            // Two input options side by side - standard iOS pattern
            HStack(spacing: 12) {
                // Camera capture
                Button {
                    showCamera = true
                } label: {
                    Label("Take Photo", systemImage: "camera")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.bordered)
                .disabled(!UIImagePickerController.isSourceTypeAvailable(.camera))

                // Photo library picker
                PhotosPicker(
                    selection: $viewModel.selectedItems,
                    maxSelectionCount: 50,
                    matching: .images
                ) {
                    Label("Library", systemImage: "photo.on.rectangle")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.bordered)
            }
            .padding(.horizontal, 24)

            // Tips
            HStack(spacing: 12) {
                tipCard("Close-ups and side profiles ID best", icon: "sparkle")
                tipCard("One bird per photo for accuracy", icon: "sparkle")
            }
            .padding(.horizontal, 16)

            Spacer()
        }
        .background(Color.pageBg.ignoresSafeArea())
        .onChange(of: viewModel.selectedItems) {
            if !viewModel.selectedItems.isEmpty {
                Task { await viewModel.processSelectedPhotos() }
            }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraCaptureView { image in
                viewModel.addCameraPhoto(image)
            }
            .ignoresSafeArea()
        }
    }

    private func tipCard(_ text: String, icon: String) -> some View {
        Label(text, systemImage: icon)
            .font(.caption)
            .foregroundStyle(Color.mutedText)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
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

#Preview {
    NavigationStack {
        PhotoSelectionView(viewModel: AddPhotosViewModel())
    }
}
