import SwiftUI

/// Container view for the multi-step Add Photos wizard.
/// Presented as a sheet from MainTabView.
struct AddPhotosFlow: View {
    @Environment(AuthService.self) private var auth
    @Environment(DataStore.self) private var store
    @State private var viewModel = AddPhotosViewModel()

    var body: some View {
        Group {
                switch viewModel.currentStep {
                case .selectPhotos:
                    PhotoSelectionView(viewModel: viewModel)
                case .processing:
                    processingView
                case .review:
                    ReviewView(viewModel: viewModel)
                case .confirm, .saving:
                    ConfirmView(viewModel: viewModel)
                case .done:
                    ConfirmView(viewModel: viewModel)
                }
            }
            .navigationTitle(navigationTitle)
            .navigationBarTitleDisplayMode(.inline)
            .background(Color.pageBg.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    switch viewModel.currentStep {
                    case .review:
                        Button("Confirm") {
                            viewModel.currentStep = .confirm
                        }
                        .disabled(viewModel.confirmedSpecies.isEmpty || viewModel.isProcessing)
                    case .confirm:
                        Button("Save") {
                            Task { await viewModel.confirmAndSave() }
                        }
                        .fontWeight(.semibold)
                        .disabled(viewModel.confirmedSpecies.isEmpty)
                    default:
                        EmptyView()
                    }
                }
            }
        .onAppear {
            viewModel.configure(
                dataService: DataService(auth: auth),
                dataStore: store
            )
        }
    }

    // MARK: - Navigation Title

    private var navigationTitle: String {
        switch viewModel.currentStep {
        case .selectPhotos: "Add Photos"
        case .processing: "Processing"
        case .review: "Review"
        case .confirm, .saving: "Confirm"
        case .done: "Complete"
        }
    }

    // MARK: - Processing View

    private var processingView: some View {
        VStack(spacing: 24) {
            Spacer()

            ProgressView(value: Double(viewModel.processedCount), total: Double(max(viewModel.totalCount, 1)))
                .progressViewStyle(.circular)
                .scaleEffect(1.5)

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
        .task {
            await viewModel.identifyBirds()
        }
    }
}

#Preview {
    AddPhotosFlow()
        .environment(AuthService())
        .environment(previewStore())
}
