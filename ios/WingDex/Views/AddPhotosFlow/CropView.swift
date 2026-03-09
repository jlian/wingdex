import SwiftUI

/// Manual crop view for the Add Photos flow.
///
/// Drag to move the crop box, pinch to resize. Corner handles provide
/// visual affordance for resizing. The area outside the crop is dimmed.
/// Background matches page color for consistent chrome appearance.
struct CropView: View {
    let imageData: Data
    let initialCropBox: CropBoxResult?
    var reason: String = "For best results, crop to one bird"
    let onBack: () -> Void
    let onSkip: () -> Void
    let onApply: (CropBoxResult) -> Void

    @State private var paddedInitialCrop: CropBoxResult
    @State private var photoScale: CGFloat = 1.0
    @State private var committedScale: CGFloat = 1.0
    @State private var photoOffset: CGSize = .zero
    @State private var committedOffset: CGSize = .zero
    @State private var initialScale: CGFloat = 1.0
    @State private var initialOffset: CGSize = .zero
    @State private var didInitializeTransform = false

    init(
        imageData: Data,
        initialCropBox: CropBoxResult?,
        reason: String = "For best results, crop to one bird",
        onBack: @escaping () -> Void,
        onSkip: @escaping () -> Void,
        onApply: @escaping (CropBoxResult) -> Void
    ) {
        self.imageData = imageData
        self.initialCropBox = initialCropBox
        self.reason = reason
        self.onBack = onBack
        self.onSkip = onSkip
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
        self._paddedInitialCrop = State(initialValue: padded)
    }

    var body: some View {
        GeometryReader { geo in
            if let uiImage = normalizedImage(from: imageData) {
                let squareSide = geo.size.width
                let fillInfo = fillImageInfo(for: uiImage, squareSide: squareSide)

                VStack(spacing: 0) {
                    Spacer(minLength: 0)

                    Text(reason)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                        .padding(.bottom, 32)

                    ZStack {
                        Color.pageBg

                        Image(uiImage: uiImage)
                            .resizable()
                            .frame(width: fillInfo.renderedW, height: fillInfo.renderedH)
                            .scaleEffect(photoScale)
                            .offset(photoOffset)
                    }
                    .frame(width: squareSide, height: squareSide)
                    .clipped()
                    .contentShape(Rectangle())
                    .gesture(photoManipulationGesture(fillInfo: fillInfo))

                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.pageBg)
                .onAppear {
                    configureInitialTransformIfNeeded(fillInfo: fillInfo)
                }
                .onChange(of: geo.size.width) {
                    didInitializeTransform = false
                    configureInitialTransformIfNeeded(fillInfo: fillInfo)
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
        .navigationTitle("Crop Bird Photo")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.pageBg, for: .navigationBar, .bottomBar)
        .toolbarBackground(.visible, for: .navigationBar, .bottomBar)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    if let cropResult = currentCropResult() {
                        onApply(cropResult)
                    }
                } label: {
                    Image(systemName: "checkmark")
                }
            }
            ToolbarItemGroup(placement: .bottomBar) {
                Button {
                    onBack()
                } label: {
                    Image(systemName: "chevron.left")
                }

                Spacer()

                Button("Skip", role: .destructive) {
                    onSkip()
                }

                Spacer()

                Button() {
                    photoScale = initialScale
                    committedScale = initialScale
                    photoOffset = initialOffset
                    committedOffset = initialOffset
                } label: {
                    Image(systemName: "arrow.counterclockwise")
                }
            }
        }
    }

    private struct FillImageInfo {
        let squareSide: CGFloat
        let naturalW: CGFloat
        let naturalH: CGFloat
        let baseScale: CGFloat
        let renderedW: CGFloat
        let renderedH: CGFloat
    }

    private func normalizedImage(from data: Data) -> UIImage? {
        guard let image = UIImage(data: data) else { return nil }
        if image.imageOrientation == .up { return image }
        return UIGraphicsImageRenderer(size: image.size).image { _ in
            image.draw(in: CGRect(origin: .zero, size: image.size))
        }
    }

    private func fillImageInfo(for image: UIImage, squareSide: CGFloat) -> FillImageInfo {
        let naturalW = image.size.width
        let naturalH = image.size.height
        let baseScale = max(squareSide / naturalW, squareSide / naturalH)
        return FillImageInfo(
            squareSide: squareSide,
            naturalW: naturalW,
            naturalH: naturalH,
            baseScale: baseScale,
            renderedW: naturalW * baseScale,
            renderedH: naturalH * baseScale
        )
    }

    private func configureInitialTransformIfNeeded(fillInfo: FillImageInfo) {
        guard !didInitializeTransform else { return }

        let cropWidthPx = fillInfo.naturalW * CGFloat(paddedInitialCrop.width / 100)
        let cropCenterX = fillInfo.naturalW * CGFloat((paddedInitialCrop.x + paddedInitialCrop.width / 2) / 100)
        let cropCenterY = fillInfo.naturalH * CGFloat((paddedInitialCrop.y + paddedInitialCrop.height / 2) / 100)

        let desiredScale = max(1, min(6, fillInfo.squareSide / max(cropWidthPx, 1) / fillInfo.baseScale))
        let proposedOffset = CGSize(
            width: -(cropCenterX - fillInfo.naturalW / 2) * fillInfo.baseScale * desiredScale,
            height: -(cropCenterY - fillInfo.naturalH / 2) * fillInfo.baseScale * desiredScale
        )
        let clamped = clampedOffset(proposedOffset, fillInfo: fillInfo, scale: desiredScale)

        initialScale = desiredScale
        initialOffset = clamped
        photoScale = desiredScale
        committedScale = desiredScale
        photoOffset = clamped
        committedOffset = clamped
        didInitializeTransform = true
    }

    private func clampedOffset(_ proposed: CGSize, fillInfo: FillImageInfo, scale: CGFloat) -> CGSize {
        let scaledW = fillInfo.renderedW * scale
        let scaledH = fillInfo.renderedH * scale
        let maxX = max(0, (scaledW - fillInfo.squareSide) / 2)
        let maxY = max(0, (scaledH - fillInfo.squareSide) / 2)
        return CGSize(
            width: min(max(proposed.width, -maxX), maxX),
            height: min(max(proposed.height, -maxY), maxY)
        )
    }

    private func photoManipulationGesture(fillInfo: FillImageInfo) -> some Gesture {
        SimultaneousGesture(
            DragGesture()
                .onChanged { value in
                    let proposed = CGSize(
                        width: committedOffset.width + value.translation.width,
                        height: committedOffset.height + value.translation.height
                    )
                    photoOffset = clampedOffset(proposed, fillInfo: fillInfo, scale: photoScale)
                }
                .onEnded { _ in
                    committedOffset = photoOffset
                },
            MagnificationGesture()
                .onChanged { value in
                    let newScale = max(1, min(6, committedScale * value))
                    photoScale = newScale
                    photoOffset = clampedOffset(photoOffset, fillInfo: fillInfo, scale: newScale)
                }
                .onEnded { _ in
                    committedScale = photoScale
                    committedOffset = clampedOffset(committedOffset, fillInfo: fillInfo, scale: photoScale)
                    photoOffset = committedOffset
                }
        )
    }

    private func currentCropResult() -> CropBoxResult? {
        guard let uiImage = normalizedImage(from: imageData) else { return nil }
        let side = UIScreen.main.bounds.width
        let fillInfo = fillImageInfo(for: uiImage, squareSide: side)
        let totalScale = fillInfo.baseScale * photoScale
        let visibleSidePx = side / totalScale
        let centerX = fillInfo.naturalW / 2 - photoOffset.width / totalScale
        let centerY = fillInfo.naturalH / 2 - photoOffset.height / totalScale
        let xPx = max(0, min(fillInfo.naturalW - visibleSidePx, centerX - visibleSidePx / 2))
        let yPx = max(0, min(fillInfo.naturalH - visibleSidePx, centerY - visibleSidePx / 2))

        return CropBoxResult(
            x: Double(xPx / fillInfo.naturalW * 100),
            y: Double(yPx / fillInfo.naturalH * 100),
            width: Double(visibleSidePx / fillInfo.naturalW * 100),
            height: Double(visibleSidePx / fillInfo.naturalH * 100)
        )
    }
}

#Preview("Default") {
    NavigationStack {
        CropView(
            imageData: PreviewData.placeholderImageData(systemName: "bird.fill", size: 400),
            initialCropBox: nil,
            onBack: {},
            onSkip: {}
        ) { _ in }
    }
}

#Preview("Multi-Bird") {
    NavigationStack {
        CropView(
            imageData: PreviewData.placeholderImageData(systemName: "bird.fill", size: 400),
            initialCropBox: CropBoxResult(x: 20, y: 30, width: 40, height: 40),
            reason: "Multiple birds detected, crop to one",
            onBack: {},
            onSkip: {}
        ) { _ in }
    }
}
