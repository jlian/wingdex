import PhotosUI
import SwiftUI

/// Photo selection step in the Add Photos flow.
///
/// Displays a photo picker and a GPS context toggle. Once photos are selected,
/// the user taps Continue to extract EXIF data and begin the identification flow.
struct PhotoSelectionView: View {
    @Bindable var viewModel: AddPhotosViewModel

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            // Camera icon
            ZStack {
                Circle()
                    .fill(Color.accentColor.opacity(0.1))
                    .frame(width: 80, height: 80)
                Image(systemName: "camera.fill")
                    .font(.system(size: 32))
                    .foregroundStyle(Color.accentColor)
            }

            // Header text
            VStack(spacing: 8) {
                Text("Select Photos")
                    .font(.system(size: 22, weight: .semibold, design: .serif))
                    .foregroundStyle(Color.foregroundText)
                Text("Choose bird photos to identify and add to your WingDex.")
                    .font(.system(size: 15))
                    .foregroundStyle(Color.mutedText)
                    .multilineTextAlignment(.center)
            }

            // Photo picker button
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

            // GPS context toggle - matching web's "Use GPS & date for better ID"
            Toggle(isOn: $viewModel.useGeoContext) {
                Label {
                    Text("Use GPS & date for better ID")
                        .font(.subheadline)
                        .foregroundStyle(Color.mutedText)
                } icon: {
                    Image(systemName: "location.fill")
                        .font(.caption)
                        .foregroundStyle(Color.accentColor.opacity(0.7))
                }
            }
            .tint(Color.accentColor)
            .padding(.horizontal, 32)
            .padding(.vertical, 8)
            .background(Color.mutedText.opacity(0.06))
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .padding(.horizontal, 16)

            // Selection count and Continue button
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

            // Tips
            HStack(spacing: 12) {
                tipCard("Close-ups and side profiles ID best")
                tipCard("One bird per photo for accuracy")
            }
            .padding(.horizontal, 16)

            Spacer()
        }
        .padding(.horizontal, 24)
        .background(Color.pageBg.ignoresSafeArea())
    }

    /// A small tip card matching the web's photo tips.
    private func tipCard(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Text("\u{2726}")
                .font(.caption)
                .foregroundStyle(Color.accentColor)
            Text(text)
                .font(.caption)
                .foregroundStyle(Color.mutedText)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.mutedText.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

#Preview {
    NavigationStack {
        PhotoSelectionView(viewModel: AddPhotosViewModel())
    }
}

#Preview("With Selection") {
    NavigationStack {
        let vm = AddPhotosViewModel()
        PhotoSelectionView(viewModel: vm)
    }
}
