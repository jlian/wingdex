import SwiftUI

struct ReviewView: View {
    @Bindable var viewModel: AddPhotosViewModel

    var body: some View {
        List {
            if viewModel.isProcessing {
                Section {
                    VStack(spacing: 12) {
                        ProgressView(value: Double(viewModel.processedCount), total: Double(max(viewModel.totalCount, 1)))
                        Text(viewModel.processingMessage)
                            .font(.subheadline)
                            .foregroundStyle(Color.mutedText)
                        Text("\(viewModel.processedCount) of \(viewModel.totalCount)")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                    .padding(.vertical, 8)
                }
            }

            ForEach(viewModel.clusters) { cluster in
                Section {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(DateFormatting.formatDate(ISO8601DateFormatter().string(from: cluster.startTime), style: .medium))
                                .font(.subheadline.weight(.medium))
                            Text("\(cluster.photos.count) photo\(cluster.photos.count == 1 ? "" : "s")")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        if cluster.centerLat != nil {
                            Image(systemName: "location.fill")
                                .font(.caption)
                                .foregroundStyle(Color.accentColor)
                        }
                    }
                } header: {
                    Text("Outing \(viewModel.clusters.firstIndex(where: { $0.id == cluster.id }).map { $0 + 1 } ?? 0)")
                }

                Section {
                    ForEach(cluster.photos, id: \.id) { photo in
                        PhotoReviewRow(
                            photo: photo,
                            identification: viewModel.identifications[photo.id],
                            confirmedSpecies: viewModel.confirmedSpecies[photo.id],
                            onConfirm: { species in
                                viewModel.confirmedSpecies[photo.id] = species
                            },
                            onSkip: {
                                viewModel.confirmedSpecies.removeValue(forKey: photo.id)
                            }
                        )
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Color.pageBg.ignoresSafeArea())
    }
}

private struct PhotoReviewRow: View {
    let photo: ProcessedPhoto
    let identification: IdentificationResult?
    let confirmedSpecies: String?
    let onConfirm: (String) -> Void
    let onSkip: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                // Thumbnail
                if let uiImage = UIImage(data: photo.thumbnail) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 60, height: 60)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }

                VStack(alignment: .leading, spacing: 4) {
                    if let species = confirmedSpecies {
                        Label {
                            Text(getDisplayName(species))
                                .font(.subheadline.weight(.medium))
                        } icon: {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(Color.accentColor)
                        }
                    } else if let id = identification, let top = id.candidates.first {
                        Text(getDisplayName(top.species))
                            .font(.subheadline.weight(.medium))
                        Text("\(Int(top.confidence * 100))% confidence")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else if identification == nil {
                        Text("Identifying...")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("No bird detected")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
            }

            // Candidate list if not yet confirmed
            if confirmedSpecies == nil, let id = identification, !id.candidates.isEmpty {
                VStack(spacing: 4) {
                    ForEach(id.candidates.prefix(3), id: \.species) { candidate in
                        Button {
                            onConfirm(candidate.species)
                        } label: {
                            HStack {
                                Text(getDisplayName(candidate.species))
                                    .font(.caption)
                                Spacer()
                                Text("\(Int(candidate.confidence * 100))%")
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(.secondary)
                            }
                            .padding(.vertical, 4)
                            .padding(.horizontal, 8)
                            .background(Color.accentColor.opacity(0.08))
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                        }
                        .buttonStyle(.plain)
                    }
                }

                Button("Skip this photo", role: .destructive) {
                    onSkip()
                }
                .font(.caption)
            }

            // Tap to change if already confirmed
            if confirmedSpecies != nil {
                Button("Change") {
                    onSkip()
                }
                .font(.caption)
                .foregroundStyle(Color.accentColor)
            }
        }
        .padding(.vertical, 4)
    }
}

#Preview {
    NavigationStack {
        ReviewView(viewModel: AddPhotosViewModel())
            .environment(previewStore())
    }
}
