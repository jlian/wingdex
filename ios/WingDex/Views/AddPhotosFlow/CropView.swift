import SwiftUI

struct CropView: View {
    let imageData: Data
    let initialCropBox: CropBoxResult?
    let onApply: (CropBoxResult) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var cropBox: CropBoxResult
    @State private var dragOffset: CGSize = .zero

    init(imageData: Data, initialCropBox: CropBoxResult?, onApply: @escaping (CropBoxResult) -> Void) {
        self.imageData = imageData
        self.initialCropBox = initialCropBox
        self.onApply = onApply
        // Default to center 50% crop if no AI suggestion
        self._cropBox = State(initialValue: initialCropBox ?? CropBoxResult(x: 25, y: 25, width: 50, height: 50))
    }

    var body: some View {
        VStack(spacing: 0) {
            GeometryReader { geo in
                if let uiImage = UIImage(data: imageData) {
                    let imageRect = CropService.renderedImageRect(
                        containerW: geo.size.width,
                        containerH: geo.size.height,
                        naturalW: uiImage.size.width,
                        naturalH: uiImage.size.height
                    )

                    ZStack {
                        Image(uiImage: uiImage)
                            .resizable()
                            .scaledToFit()

                        // Crop overlay
                        let cropX = imageRect.offsetX + imageRect.renderedW * cropBox.x / 100
                        let cropY = imageRect.offsetY + imageRect.renderedH * cropBox.y / 100
                        let cropW = imageRect.renderedW * cropBox.width / 100
                        let cropH = imageRect.renderedH * cropBox.height / 100

                        Rectangle()
                            .stroke(Color.accentColor, lineWidth: 2)
                            .background(Color.accentColor.opacity(0.1))
                            .frame(width: cropW, height: cropH)
                            .position(x: cropX + cropW / 2, y: cropY + cropH / 2)
                            .gesture(
                                DragGesture()
                                    .onChanged { value in
                                        let dx = value.translation.width / imageRect.renderedW * 100
                                        let dy = value.translation.height / imageRect.renderedH * 100
                                        let newX = max(0, min(100 - cropBox.width, (initialCropBox?.x ?? cropBox.x) + dx))
                                        let newY = max(0, min(100 - cropBox.height, (initialCropBox?.y ?? cropBox.y) + dy))
                                        cropBox = CropBoxResult(x: newX, y: newY, width: cropBox.width, height: cropBox.height)
                                    }
                            )
                    }
                }
            }

            HStack(spacing: 16) {
                Button("Reset") {
                    cropBox = initialCropBox ?? CropBoxResult(x: 25, y: 25, width: 50, height: 50)
                }
                .buttonStyle(.bordered)

                Spacer()

                Button("Apply Crop") {
                    onApply(cropBox)
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .tint(Color.accentColor)
            }
            .padding()
        }
        .background(Color.pageBg.ignoresSafeArea())
        .navigationTitle("Crop")
        .navigationBarTitleDisplayMode(.inline)
    }
}

#Preview {
    NavigationStack {
        CropView(imageData: Data(), initialCropBox: nil) { _ in }
    }
}
