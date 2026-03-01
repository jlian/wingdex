import SwiftUI

struct CropView: View {
    var body: some View {
        VStack {
            // TODO: Image display with draggable crop overlay
            // TODO: Use CropService for coordinate math
            Rectangle()
                .fill(.secondary.opacity(0.2))
                .overlay {
                    Text("Crop Preview")
                        .foregroundStyle(.secondary)
                }
                .aspectRatio(1, contentMode: .fit)
                .padding()

            // TODO: Confirm/reset crop buttons
            HStack {
                Button("Reset") {
                    // TODO: Reset crop to AI-suggested box
                }
                Spacer()
                Button("Apply") {
                    // TODO: Apply crop
                }
                .buttonStyle(.borderedProminent)
            }
            .padding()
        }
        .navigationTitle("Crop")
    }
}

#Preview {
    NavigationStack {
        CropView()
    }
}
