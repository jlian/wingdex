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
    @State private var selectedTab = Tab.home
    @State private var showingAddPhotos = false

    enum Tab: Hashable {
        case home, outings, wingdex, settings
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            Tab.home.tabItem(
                HomeView(showingAddPhotos: $showingAddPhotos),
                label: "Home",
                systemImage: "house",
                tag: .home
            )
            Tab.outings.tabItem(
                OutingsView(),
                label: "Outings",
                systemImage: "binoculars",
                tag: .outings
            )
            Tab.wingdex.tabItem(
                WingDexView(),
                label: "WingDex",
                systemImage: "list.bird",
                tag: .wingdex
            )
            Tab.settings.tabItem(
                SettingsView(),
                label: "Settings",
                systemImage: "gear",
                tag: .settings
            )
        }
        .sheet(isPresented: $showingAddPhotos) {
            // TODO: AddPhotosFlow
            Text("Add Photos Flow")
        }
    }
}

private extension MainTabView.Tab {
    func tabItem<Content: View>(
        _ content: Content,
        label: String,
        systemImage: String,
        tag: MainTabView.Tab
    ) -> some View {
        content
            .tabItem {
                Label(label, systemImage: systemImage)
            }
            .tag(tag)
    }
}

#Preview {
    ContentView()
        .environment(AuthService())
}
