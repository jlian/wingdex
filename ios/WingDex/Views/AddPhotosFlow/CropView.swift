import SwiftUI

/// Manual crop view for the Add Photos flow.
///
/// Drag to move the crop box, pinch to resize. Corner handles provide
/// visual affordance for resizing. The area outside the crop is dimmed.
/// Background matches page color for consistent chrome appearance.
struct CropView: View {
    let imageData: Data
    let initialCropBox: CropBoxResult?
    var reason: String = "Crop to the bird you want to identify"
    let onApply: (CropBoxResult) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var cropBox: CropBoxResult
    @State private var paddedInitialCrop: CropBoxResult
    @State private var dragStartCrop: CropBoxResult?
    @State private var pinchScale: CGFloat = 1.0

    init(imageData: Data, initialCropBox: CropBoxResult?, reason: String = "Crop to the bird you want to identify", onApply: @escaping (CropBoxResult) -> Void) {
        self.imageData = imageData
        self.initialCropBox = initialCropBox
        self.reason = reason
        self.onApply = onApply

        let defaultCrop = CropBoxResult(x: 15, y: 15, width: 70, height: 70)
        let padded: CropBoxResult
        if let aiCrop = initialCropBox, let uiImage = UIImage(data: imageData) {
            let natW = uiImage.size.width
            let natH = uiImage.size.height
            let pixelCrop = CropService.paddedSquareCrop(
                from: CropService.CropBox(x: aiCrop.x, y: aiCrop.y, width: aiCrop.width, height: aiCrop.height),
                naturalWidth: natW, naturalHeight: natH
            )
            padded = CropBoxResult(
                x: pixelCrop.x / natW * 100, y: pixelCrop.y / natH * 100,
                width: pixelCrop.width / natW * 100, height: pixelCrop.height / natH * 100
            )
        } else {
            padded = defaultCrop
        }
        self._cropBox = State(initialValue: padded)
        self._paddedInitialCrop = State(initialValue: padded)
    }

    var body: some View {
        // Image with crop overlay - pageBg background for consistent chrome
        GeometryReader { geo in
            if let uiImage = UIImage(data: imageData) {
                let imageRect = CropService.renderedImageRect(
                    containerW: geo.size.width, containerH: geo.size.height,
                    naturalW: uiImage.size.width, naturalH: uiImage.size.height
                )

                ZStack {
                    // Page background fills the whole area
                    Color.pageBg

                    // Full image
                    Image(uiImage: uiImage)
                        .resizable()
                        .scaledToFit()

                    // Dimmed overlay outside crop area
                    let cropX = imageRect.offsetX + imageRect.renderedW * cropBox.x / 100
                    let cropY = imageRect.offsetY + imageRect.renderedH * cropBox.y / 100
                    let cropW = imageRect.renderedW * cropBox.width / 100
                    let cropH = imageRect.renderedH * cropBox.height / 100

                    Canvas { context, size in
                        context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(.black.opacity(0.4)))
                        context.blendMode = .destinationOut
                        context.fill(Path(CGRect(x: cropX, y: cropY, width: cropW, height: cropH)), with: .color(.white))
                    }
                    .allowsHitTesting(false)

                    // Crop border + corner handles
                    Rectangle()
                        .stroke(Color.white, lineWidth: 2)
                        .frame(width: cropW, height: cropH)
                        .position(x: cropX + cropW / 2, y: cropY + cropH / 2)

                    let corners: [(CGFloat, CGFloat)] = [
                        (cropX, cropY), (cropX + cropW, cropY),
                        (cropX, cropY + cropH), (cropX + cropW, cropY + cropH),
                    ]
                    ForEach(0..<4, id: \.self) { i in
                        Circle()
                            .fill(Color.white)
                            .frame(width: 16, height: 16)
                            .shadow(radius: 2)
                            .position(x: corners[i].0, y: corners[i].1)
                    }

                    // Drag to move + pinch to resize
                    Color.clear
                        .contentShape(Rectangle())
                        .gesture(
                            DragGesture()
                                .onChanged { value in
                                    let start = dragStartCrop ?? cropBox
                                    if dragStartCrop == nil { dragStartCrop = cropBox }
                                    let dx = value.translation.width / imageRect.renderedW * 100
                                    let dy = value.translation.height / imageRect.renderedH * 100
                                    cropBox = CropBoxResult(
                                        x: max(0, min(100 - cropBox.width, start.x + dx)),
                                        y: max(0, min(100 - cropBox.height, start.y + dy)),
                                        width: cropBox.width, height: cropBox.height
                                    )
                                }
                                .onEnded { _ in dragStartCrop = nil }
                        )
                        .simultaneousGesture(
                            MagnificationGesture()
                                .onChanged { scale in
                                    let delta = scale / pinchScale
                                    pinchScale = scale
                                    resizeCrop(by: delta)
                                }
                                .onEnded { _ in pinchScale = 1.0 }
                        )
                }
            } else {
                Color.pageBg
                    .overlay {
                        Image(systemName: "photo")
                            .font(.largeTitle)
                            .foregroundStyle(.tertiary)
                    }
            }
        }
        .background(Color.pageBg.ignoresSafeArea())
        .navigationTitle("Crop Photo")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // Bottom bar: (left empty) | Reset (center) | Apply (right)
            ToolbarItemGroup(placement: .bottomBar) {
                Spacer()

                // Reason text + reset in center
                Text(reason)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)

                Button("Reset", systemImage: "arrow.counterclockwise") {
                    cropBox = paddedInitialCrop
                }

                Spacer()

                // Apply (right)
                Button {
                    onApply(cropBox)
                    dismiss()
                } label: {
                    Label("Apply", systemImage: "chevron.right")
                        .labelStyle(.titleAndIcon)
                }
            }
        }
    }

    private func resizeCrop(by factor: CGFloat) {
        let centerX = cropBox.x + cropBox.width / 2
        let centerY = cropBox.y + cropBox.height / 2
        let newW = max(15, min(100, cropBox.width * factor))
        let newH = max(15, min(100, cropBox.height * factor))
        cropBox = CropBoxResult(
            x: max(0, min(100 - newW, centerX - newW / 2)),
            y: max(0, min(100 - newH, centerY - newH / 2)),
            width: newW, height: newH
        )
    }
}

#Preview("Default") {
    NavigationStack {
        CropView(imageData: PreviewData.placeholderImageData(systemName: "bird.fill", size: 400), initialCropBox: nil) { _ in }
    }
}

#Preview("Multi-Bird") {
    NavigationStack {
        CropView(
            imageData: PreviewData.placeholderImageData(systemName: "bird.fill", size: 400),
            initialCropBox: CropBoxResult(x: 20, y: 30, width: 40, height: 40),
            reason: "Multiple birds - crop to one"
        ) { _ in }
    }
}
