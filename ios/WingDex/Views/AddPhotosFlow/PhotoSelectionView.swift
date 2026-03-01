import SwiftUI
import PhotosUI

struct PhotoSelectionView: View {
    @State private var selectedItems: [PhotosPickerItem] = []

    var body: some View {
        VStack(spacing: 16) {
            Text("Select Photos")
                .font(.title2.bold())

            Text("Choose bird photos to identify")
                .foregroundStyle(.secondary)

            PhotosPicker(
                selection: $selectedItems,
                maxSelectionCount: 50,
                matching: .images
            ) {
                Label("Select Photos", systemImage: "photo.on.rectangle.angled")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)

            if !selectedItems.isEmpty {
                Text("\(selectedItems.count) photo(s) selected")
                    .foregroundStyle(.secondary)

                Button("Continue") {
                    // TODO: Extract EXIF, cluster, navigate to ReviewView
                }
                .buttonStyle(.borderedProminent)
            }

            Spacer()
        }
        .padding()
        .navigationTitle("Add Photos")
    }
}

#Preview {
    NavigationStack {
        PhotoSelectionView()
    }
}
