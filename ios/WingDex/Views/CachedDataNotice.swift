import SwiftUI

struct CachedDataNotice: View {
    @Environment(DataStore.self) private var store

    var body: some View {
        if store.isShowingCachedData {
            Label("Offline data - reconnect to make changes", systemImage: "wifi.slash")
                .font(.footnote.weight(.medium))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(.bar)
                .accessibilityIdentifier("cached-data-notice")
        }
    }
}