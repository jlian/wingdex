import SwiftUI

struct PhotoSequenceToolbar: View {
    let photos: [ProcessedPhoto]
    let selectedPhotoID: String?
    var accessibilityID = "confirm.photoCounter"
    @State private var showPhotos = false

    private var selectedIndex: Int? {
        photos.firstIndex { $0.id == selectedPhotoID }
    }

    var body: some View {
        Button {
            showPhotos = true
        } label: {
            Text(selectedIndex.map { "Photo \($0 + 1) of \(photos.count)" } ?? "Photos")
                .font(.headline)
                .lineLimit(1)
        }
        .tint(.primary)
        .accessibilityIdentifier(accessibilityID)
        .accessibilityHint("Opens all photos in this outing")
        .disabled(selectedIndex == nil)
        .sheet(isPresented: $showPhotos) {
            if let selectedPhotoID {
                NavigationStack {
                    PhotoReviewSheet(photos: photos, selectedPhotoID: selectedPhotoID)
                }
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
            }
        }
    }
}
