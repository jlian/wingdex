import SwiftUI

struct CropView: View {
    let imageData: Data
    let initialCropBox: CropBoxResult?
    let onApply: (CropBoxResult) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var cropBox: CropBoxResult
    @State private var paddedInitialCrop: CropBoxResult
    @State private var dragStartCrop: CropBoxResult?

    init(imageData: Data, initialCropBox: CropBoxResult?, onApply: @escaping (CropBoxResult) -> Void) {
        self.imageData = imageData
        self.initialCropBox = initialCropBox
        self.onApply = onApply

        // Convert AI percentage crop to padded square, matching web's computePaddedSquareCropFromPercent
        let defaultCrop = CropBoxResult(x: 25, y: 25, width: 50, height: 50)
        let padded: CropBoxResult
        if let aiCrop = initialCropBox, let uiImage = UIImage(data: imageData) {
            let natW = uiImage.size.width
            let natH = uiImage.size.height
            let pixelCrop = CropService.paddedSquareCrop(
                from: CropService.CropBox(x: aiCrop.x, y: aiCrop.y, width: aiCrop.width, height: aiCrop.height),
                naturalWidth: natW,
                naturalHeight: natH
            )
            padded = CropBoxResult(
                x: pixelCrop.x / natW * 100,
                y: pixelCrop.y / natH * 100,
                width: pixelCrop.width / natW * 100,
                height: pixelCrop.height / natH * 100
            )
        } else {
            padded = defaultCrop
        }
        self._cropBox = State(initialValue: padded)
        self._paddedInitialCrop = State(initialValue: padded)
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
                                        let start = dragStartCrop ?? cropBox
                                        if dragStartCrop == nil { dragStartCrop = cropBox }
                                        let dx = value.translation.width / imageRect.renderedW * 100
                                        let dy = value.translation.height / imageRect.renderedH * 100
                                        let newX = max(0, min(100 - cropBox.width, start.x + dx))
                                        let newY = max(0, min(100 - cropBox.height, start.y + dy))
                                        cropBox = CropBoxResult(x: newX, y: newY, width: cropBox.width, height: cropBox.height)
                                    }
                                    .onEnded { _ in
                                        dragStartCrop = nil
                                    }
                            )
                    }
                }
            }

            HStack(spacing: 16) {
                Button("Reset") {
                    cropBox = paddedInitialCrop
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
