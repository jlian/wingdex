import SwiftUI

@main
struct WingDexApp: App {
    @State private var authService = AuthService()
    @State private var dataStore: DataStore

    init() {
        let auth = AuthService()
        _authService = State(initialValue: auth)
        _dataStore = State(initialValue: DataStore(service: DataService(auth: auth)))
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(authService)
                .environment(dataStore)
        }
    }
}

/// Root view that shows either auth or the main tab interface.
struct ContentView: View {
    @Environment(AuthService.self) private var auth
    @Environment(DataStore.self) private var store

    var body: some View {
        Group {
            if auth.isAuthenticated {
                MainTabView()
                    .task {
                        await store.loadAll()
                    }
            } else {
                SignInView()
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
    let auth = AuthService()
    ContentView()
        .environment(auth)
        .environment(DataStore(service: DataService(auth: auth)))
}
