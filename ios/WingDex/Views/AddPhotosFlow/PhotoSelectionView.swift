import PhotosUI
import SwiftUI

struct PhotoSelectionView: View {
    @Bindable var viewModel: AddPhotosViewModel

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            ZStack {
                Circle()
                    .fill(Color.accentColor.opacity(0.1))
                    .frame(width: 80, height: 80)
                Image(systemName: "camera.fill")
                    .font(.system(size: 32))
                    .foregroundStyle(Color.accentColor)
            }

            VStack(spacing: 8) {
                Text("Select Photos")
                    .font(.system(size: 22, weight: .semibold, design: .serif))
                    .foregroundStyle(Color.foregroundText)
                Text("Choose bird photos to identify and add to your WingDex.")
                    .font(.system(size: 15))
                    .foregroundStyle(Color.mutedText)
                    .multilineTextAlignment(.center)
            }

            PhotosPicker(
                selection: $viewModel.selectedItems,
                maxSelectionCount: 50,
                matching: .images
            ) {
                Label {
                    Text("Choose Photos")
                        .font(.system(size: 16, weight: .medium))
                } icon: {
                    Image(systemName: "photo.on.rectangle.angled")
                }
                .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.bordered)
            .tint(Color.foregroundText)
            .padding(.horizontal, 32)

            if !viewModel.selectedItems.isEmpty {
                Text("\(viewModel.selectedItems.count) photo\(viewModel.selectedItems.count == 1 ? "" : "s") selected")
                    .font(.subheadline)
                    .foregroundStyle(Color.mutedText)

                Button {
                    Task { await viewModel.processSelectedPhotos() }
                } label: {
                    Label {
                        Text("Continue")
                            .font(.system(size: 16, weight: .medium))
                    } icon: {
                        Image(systemName: "arrow.right")
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color.accentColor)
                .padding(.horizontal, 32)
            }

            Spacer()
        }
        .padding(.horizontal, 24)
        .background(Color.pageBg.ignoresSafeArea())
    }
}

#Preview {
    NavigationStack {
        PhotoSelectionView(viewModel: AddPhotosViewModel())
    }
}
