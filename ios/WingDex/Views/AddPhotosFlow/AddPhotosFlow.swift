import SwiftUI

/// Container view for the multi-step Add Photos wizard.
///
/// Presented as a sheet from MainTabView. Orchestrates the full flow:
/// selectPhotos -> extracting -> outingReview -> photoProcessing ->
/// perPhotoConfirm -> (manualCrop) -> [next photo or save] -> done
struct AddPhotosFlow: View {
    @Environment(AuthService.self) private var auth
    @Environment(DataStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var viewModel = AddPhotosViewModel()
    @State private var showCloseConfirm = false

    /// Whether the current step needs a close confirmation (user has unsaved progress).
    private var needsCloseConfirmation: Bool {
        switch viewModel.currentStep {
        case .selectPhotos, .done: return false
        default: return true
        }
    }

    var body: some View {
        Group {
            switch viewModel.currentStep {
            case .selectPhotos:
                PhotoSelectionView(viewModel: viewModel)
            case .extracting:
                extractingView
            case .outingReview:
                OutingReviewView(viewModel: viewModel)
            case .photoProcessing:
                photoProcessingView
            case .perPhotoConfirm:
                PerPhotoConfirmView(viewModel: viewModel)
            case .manualCrop:
                manualCropDestination
            case .saving:
                savingView
            case .done:
                doneView
            }
        }
        .navigationTitle(navigationTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button {
                    if needsCloseConfirmation {
                        showCloseConfirm = true
                    } else {
                        dismiss()
                    }
                } label: {
                    Image(systemName: "xmark")
                }
            }
        }
        .confirmationDialog("Discard progress?", isPresented: $showCloseConfirm, titleVisibility: .visible) {
            Button("Discard", role: .destructive) { dismiss() }
            Button("Continue Uploading", role: .cancel) {}
        } message: {
            Text("Your upload is still in progress. If you close now, any unsaved changes will be lost.")
        }
        .background(Color.pageBg.ignoresSafeArea())
        .onAppear {
            viewModel.configure(
                dataService: DataService(auth: auth),
                dataStore: store
            )
        }
        // Duplicate photo detection alert
        .alert("Duplicate photos found", isPresented: $viewModel.showDuplicateConfirm) {
            Button("Skip duplicates") {
                viewModel.handleDuplicateChoice(reimport: false)
            }
            Button("Re-import") {
                viewModel.handleDuplicateChoice(reimport: true)
            }
        } message: {
            let dupCount = viewModel.pendingDuplicatePhotos.count
            let newCount = viewModel.pendingNewPhotos.count
            if newCount > 0 {
                Text("\(dupCount) of \(dupCount + newCount) photos have already been imported. Re-importing will add duplicate sightings.")
            } else {
                Text(dupCount == 1
                     ? "This photo has already been imported."
                     : "All \(dupCount) photos have already been imported.")
            }
        }
    }

    // MARK: - Navigation Title

    private var navigationTitle: String {
        switch viewModel.currentStep {
        case .selectPhotos:
            return "Add Photos"
        case .extracting:
            return "Reading Photos..."
        case .outingReview:
            let clusters = viewModel.clusters
            if clusters.count > 1 {
                return "Review Outing \(viewModel.currentClusterIndex + 1) of \(clusters.count)"
            }
            return "Review Outing"
        case .photoProcessing:
            return "Identifying photo \(viewModel.currentPhotoIndex + 1) of \(viewModel.clusterPhotos.count)..."
        case .perPhotoConfirm:
            return "Photo \(viewModel.currentPhotoIndex + 1) of \(viewModel.clusterPhotos.count)"
        case .manualCrop:
            return "Crop Photo \(viewModel.currentPhotoIndex + 1)"
        case .saving:
            return "Saving..."
        case .done:
            return "Upload Complete"
        }
    }

    // MARK: - Extracting EXIF View

    /// Progress bar while loading and extracting EXIF from selected photos.
    private var extractingView: some View {
        VStack(spacing: 24) {
            Spacer()

            ProgressView(value: viewModel.extractionProgress, total: 100)
                .progressViewStyle(.linear)
                .padding(.horizontal, 40)

            VStack(spacing: 8) {
                Text(viewModel.processingMessage)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Color.foregroundText)
                Text("\(viewModel.processedCount) of \(viewModel.totalCount)")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(Color.mutedText)
            }

            Spacer()
        }
        .padding(.horizontal, 24)
        .background(Color.pageBg.ignoresSafeArea())
    }

    // MARK: - Photo Processing (AI Identification) View

    /// Spinner + exponential progress bar while AI identifies the current photo.
    private var photoProcessingView: some View {
        VStack(spacing: 20) {
            Spacer()

            // Show the full current image aspect-fit, not a square crop.
            if let photo = viewModel.currentPhoto,
               let uiImage = UIImage(data: photo.croppedImage ?? photo.image) {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: 320, maxHeight: 260)
            }

            // Exponential progress bar (matching web's `1 - e^(-t/tau)` curve)
            ExponentialProgressBar(
                progress: $viewModel.photoProgress,
                tauMs: viewModel.photoProgressTauMs,
                runKey: viewModel.photoProgressRunKey
            )
            .id(viewModel.photoProgressRunKey)
            .frame(height: 6)
            .padding(.horizontal, 40)

            Text(viewModel.processingMessage)
                .font(.subheadline)
                .foregroundStyle(Color.mutedText)
                .multilineTextAlignment(.center)

            Spacer()
        }
        .padding(.horizontal, 24)
        .background(Color.pageBg.ignoresSafeArea())
    }

    // MARK: - Manual Crop Destination

    /// Shows the CropView for the current photo, passing the AI crop box if available.
    /// Displays a context-specific reason (multi-bird, no detection, or manual re-crop).
    @ViewBuilder
    private var manualCropDestination: some View {
        if let photo = viewModel.currentPhoto {
            CropView(
                imageData: photo.image,
                initialCropBox: photo.aiCropBox,
                reason: viewModel.cropPromptContext.reasonText,
                onBack: {
                    viewModel.cancelCrop()
                },
                onSkip: {
                    viewModel.skipCurrentPhoto()
                },
                onApply: { cropResult in
                    // Generate cropped image data from the crop box
                    if let croppedData = generateCroppedImageData(from: photo.image, cropBox: cropResult) {
                        viewModel.handleCropComplete(croppedImageData: croppedData)
                    } else {
                        viewModel.cancelCrop()
                    }
                }
            )
        } else {
            // Shouldn't happen, but handle gracefully
            Text("No photo available")
                .foregroundStyle(Color.mutedText)
                .onAppear { viewModel.cancelCrop() }
        }
    }

    // MARK: - Saving View

    private var savingView: some View {
        VStack(spacing: 24) {
            Spacer()
            ProgressView()
                .controlSize(.large)
            Text("Saving observations...")
                .font(.subheadline)
                .foregroundStyle(Color.mutedText)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.pageBg.ignoresSafeArea())
    }

    // MARK: - Done / Summary View

    /// Upload summary matching the web's summary screen.
    private var doneView: some View {
        VStack(spacing: 24) {
            Spacer()

            // Success icon
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 56))
                .foregroundStyle(Color.accentColor)
                .symbolEffect(.bounce, value: viewModel.currentStep)

            // Summary header
            if let summary = viewModel.uploadSummary {
                VStack(spacing: 4) {
                    if !summary.locationNames.isEmpty {
                        Text(summary.locationNames.joined(separator: ", "))
                            .font(.system(size: 18, weight: .semibold, design: .serif))
                            .foregroundStyle(Color.foregroundText)
                            .multilineTextAlignment(.center)
                    }
                    Text("\(summary.outings) \(summary.outings == 1 ? "outing" : "outings") saved")
                        .font(.subheadline)
                        .foregroundStyle(Color.mutedText)
                }

                // Stats cards
                HStack(spacing: 12) {
                    summaryCard(value: summary.totalSpecies, label: "Species confirmed")
                    summaryCard(value: summary.totalCount, label: "Total sightings")
                    summaryCard(value: summary.newSpecies, label: "New to WingDex", highlight: summary.newSpecies > 0)
                }
                .padding(.horizontal)
            } else {
                VStack(spacing: 8) {
                    Text("Upload Complete!")
                        .font(.system(size: 22, weight: .semibold, design: .serif))
                        .foregroundStyle(Color.foregroundText)
                    Text("\(viewModel.savedOutingCount) outing\(viewModel.savedOutingCount == 1 ? "" : "s") created")
                        .font(.subheadline)
                        .foregroundStyle(Color.mutedText)
                    if viewModel.newSpeciesCount > 0 {
                        Text("\(viewModel.newSpeciesCount) new species!")
                            .fontWeight(.semibold)
                            .foregroundStyle(Color.accentColor)
                    }
                }
            }

            // Done button
            Button {
                dismiss()
            } label: {
                Text("Done")
                    .font(.system(size: 16, weight: .medium))
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .tint(Color.accentColor)
            .padding(.horizontal, 32)

            Spacer()
        }
        .padding(.horizontal, 24)
        .background(Color.pageBg.ignoresSafeArea())
    }

    /// A summary stat card for the done screen.
    private func summaryCard(value: Int, label: String, highlight: Bool = false) -> some View {
        VStack(spacing: 4) {
            Text("\(value)")
                .font(.title2.bold().monospacedDigit())
                .foregroundStyle(highlight ? Color.accentColor : Color.foregroundText)
            Text(label)
                .font(.caption2)
                .foregroundStyle(Color.mutedText)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
    }

    // MARK: - Crop Helpers

    /// Generate cropped image data from the original image and a percentage crop box.
    private func generateCroppedImageData(from imageData: Data, cropBox: CropBoxResult) -> Data? {
        guard let uiImage = UIImage(data: imageData),
              let cgImage = uiImage.cgImage
        else { return nil }

        let natW = CGFloat(cgImage.width)
        let natH = CGFloat(cgImage.height)

        // Convert percentage crop to pixel coordinates
        let cropX = natW * cropBox.x / 100
        let cropY = natH * cropBox.y / 100
        let cropW = natW * cropBox.width / 100
        let cropH = natH * cropBox.height / 100

        let rect = CGRect(x: cropX, y: cropY, width: cropW, height: cropH)
            .intersection(CGRect(x: 0, y: 0, width: natW, height: natH))

        guard rect.width > 0, rect.height > 0,
              let cropped = cgImage.cropping(to: rect)
        else { return nil }

        let result = UIImage(cgImage: cropped, scale: uiImage.scale, orientation: uiImage.imageOrientation)
        return result.jpegData(compressionQuality: 0.7)
    }
}

// MARK: - Exponential Progress Bar

/// Animated progress bar that follows `90 * (1 - e^(-t/tau))`, matching web behavior.
///
/// Uses SwiftUI's TimelineView for smooth updates that respect the view lifecycle.
/// Resets whenever `runKey` changes (e.g., when escalating from fast to strong model).
struct ExponentialProgressBar: View {
    @Binding var progress: Double
    let tauMs: Double
    let runKey: Int

    @State private var startDate = Date()

    var body: some View {
        TimelineView(.animation(minimumInterval: 0.08)) { timeline in
            let elapsed = timeline.date.timeIntervalSince(startDate) * 1000
            let computed = 90 * (1 - exp(-elapsed / tauMs))

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Color.mutedText.opacity(0.15))
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Color.accentColor)
                        .frame(width: geo.size.width * min(max(computed, progress) / 100, 1))
                }
            }
            .onChange(of: computed) {
                // Keep the binding in sync for external reads
                progress = max(progress, min(90, computed))
            }
        }
        .onChange(of: runKey) {
            startDate = Date()
            progress = 0
        }
        .onAppear {
            startDate = Date()
        }
    }
}

// MARK: - Preview

#Preview {
    NavigationStack {
        AddPhotosFlow()
            .environment(AuthService())
            .environment(previewStore())
    }
}

