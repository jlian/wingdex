import SwiftUI

struct ConfirmView: View {
    @Bindable var viewModel: AddPhotosViewModel
    @Environment(\.dismiss) private var dismiss

    private var confirmedCount: Int {
        viewModel.confirmedSpecies.count
    }

    private var uniqueSpecies: [String] {
        Array(Set(viewModel.confirmedSpecies.values)).sorted()
    }

    private var outingsWithConfirmed: [PhotoCluster] {
        viewModel.clusters.filter { cluster in
            cluster.photos.contains { viewModel.confirmedSpecies[$0.id] != nil }
        }
    }

    var body: some View {
        Group {
            if viewModel.currentStep == .done {
                doneView
            } else {
                confirmList
            }
        }
    }

    private var confirmList: some View {
        List {
            // Summary
            Section {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(outingsWithConfirmed.count)")
                            .font(.title.bold().monospacedDigit())
                            .foregroundStyle(Color.accentColor)
                        Text(outingsWithConfirmed.count == 1 ? "outing" : "outings")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(uniqueSpecies.count)")
                            .font(.title.bold().monospacedDigit())
                            .foregroundStyle(Color.accentColor)
                        Text(uniqueSpecies.count == 1 ? "species" : "species")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(confirmedCount)")
                            .font(.title.bold().monospacedDigit())
                            .foregroundStyle(Color.accentColor)
                        Text(confirmedCount == 1 ? "observation" : "observations")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
            }

            // Species list
            Section("Species") {
                ForEach(uniqueSpecies, id: \.self) { species in
                    let count = viewModel.confirmedSpecies.values.filter { $0 == species }.count
                    HStack {
                        Text(getDisplayName(species))
                            .font(.subheadline)
                        Spacer()
                        Text("x\(count)")
                            .font(.subheadline.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
            }

            if let error = viewModel.error {
                Section {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Color.pageBg.ignoresSafeArea())
    }

    private var doneView: some View {
        VStack(spacing: 24) {
            Spacer()

            ZStack {
                Circle()
                    .fill(Color.accentColor.opacity(0.1))
                    .frame(width: 80, height: 80)
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 40))
                    .foregroundStyle(Color.accentColor)
            }

            VStack(spacing: 8) {
                Text("Upload Complete!")
                    .font(.system(size: 22, weight: .semibold, design: .serif))
                    .foregroundStyle(Color.foregroundText)

                VStack(spacing: 4) {
                    Text("\(viewModel.savedOutingCount) outing\(viewModel.savedOutingCount == 1 ? "" : "s") created")
                    Text("\(viewModel.savedObservationCount) observation\(viewModel.savedObservationCount == 1 ? "" : "s") saved")
                    if viewModel.newSpeciesCount > 0 {
                        Text("\(viewModel.newSpeciesCount) new species!")
                            .fontWeight(.semibold)
                            .foregroundStyle(Color.accentColor)
                    }
                }
                .font(.system(size: 15))
                .foregroundStyle(Color.mutedText)
            }

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
}

#Preview {
    NavigationStack {
        ConfirmView(viewModel: AddPhotosViewModel())
    }
}
