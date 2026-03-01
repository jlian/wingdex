import SwiftUI

@main
struct WingDexApp: App {
    @State private var authService = AuthService()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(authService)
        }
    }
}

/// Root view that shows either auth or the main tab interface.
struct ContentView: View {
    @Environment(AuthService.self) private var auth

    var body: some View {
        Group {
            if auth.isAuthenticated {
                MainTabView()
            } else {
                // TODO: Sign-in view
                Text("Sign In")
                    .font(.largeTitle)
            }
        }
    }
}

/// Four-tab main interface.
struct MainTabView: View {
    @State private var selectedTab = AppTab.home
    @State private var showingAddPhotos = false

    enum AppTab: Hashable {
        case home, outings, wingdex, settings
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            Tab("Home", systemImage: "house", value: AppTab.home) {
                HomeView(showingAddPhotos: $showingAddPhotos)
            }
            Tab("Outings", systemImage: "binoculars", value: AppTab.outings) {
                OutingsView()
            }
            Tab("WingDex", systemImage: "list.bird", value: AppTab.wingdex) {
                WingDexView()
            }
            Tab("Settings", systemImage: "gear", value: AppTab.settings) {
                SettingsView()
            }
        }
        .sheet(isPresented: $showingAddPhotos) {
            // TODO: AddPhotosFlow
            Text("Add Photos Flow")
        }
    }
}

#Preview {
    ContentView()
        .environment(AuthService())
}
