import SwiftUI

@main
struct WingDexApp: App {
    @State private var authService: AuthService
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
                .tint(Color.accentColor)
        }
    }
}

/// Root view that shows either auth or the main tab interface.
struct ContentView: View {
    @Environment(AuthService.self) private var auth
    @Environment(DataStore.self) private var store

    var body: some View {
        ZStack {
            Color.pageBg.ignoresSafeArea()

            if auth.isAuthenticated {
                MainTabView()
                    .task {
                        await store.loadAll()
                        #if DEBUG
                        if ProcessInfo.processInfo.arguments.contains("--auto-demo-data"),
                           store.dex.isEmpty {
                            try? await store.loadDemoData()
                        }
                        #endif
                    }
            } else {
                SignInView()
                    #if DEBUG
                    .task {
                        if ProcessInfo.processInfo.arguments.contains("--auto-sign-in"),
                           !auth.isAuthenticated {
                            try? await auth.signInAnonymously()
                        }
                    }
                    #endif
            }
        }
    }
}

/// Three-tab main interface with detached "+" and avatar settings sheet.
struct MainTabView: View {
    @Environment(AuthService.self) private var auth
    @State private var selectedTab = AppTab.home
    @State private var showingAddPhotos = false
    @State private var showingSettings = false

    enum AppTab: Hashable {
        case home, outings, wingdex
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            Tab("Home", systemImage: "house", value: AppTab.home) {
                NavigationStack {
                    HomeView()
                        .toolbar { avatarToolbarItem }
                }
            }
            Tab("WingDex", image: "BirdTab", value: AppTab.wingdex) {
                NavigationStack {
                    WingDexView()
                        .toolbar { avatarToolbarItem }
                }
            }
            Tab("Outings", systemImage: "binoculars", value: AppTab.outings) {
                NavigationStack {
                    OutingsView()
                        .toolbar { avatarToolbarItem }
                }
            }
        }
        .tabViewBottomAccessory {
            Button {
                showingAddPhotos = true
            } label: {
                Image(systemName: "plus.circle.fill")
                    .font(.system(size: 28))
                    .symbolRenderingMode(.hierarchical)
            }
        }
        .sheet(isPresented: $showingAddPhotos) {
            AddPhotosFlow()
        }
        .sheet(isPresented: $showingSettings) {
            SettingsView()
        }
        .environment(\.showAddPhotos) { showingAddPhotos = true }
    }

    private var avatarToolbarItem: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Button {
                showingSettings = true
            } label: {
                if let image = auth.userImage, !image.isEmpty,
                   let url = URL(string: image) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let img):
                            img.resizable()
                                .scaledToFill()
                                .frame(width: 28, height: 28)
                                .clipShape(Circle())
                        default:
                            Image(systemName: "person.circle.fill")
                                .font(.system(size: 22))
                                .foregroundStyle(Color.mutedText)
                        }
                    }
                } else {
                    Image(systemName: "person.circle.fill")
                        .font(.system(size: 22))
                        .foregroundStyle(Color.mutedText)
                }
            }
        }
    }
}

#Preview {
    let auth = AuthService()
    ContentView()
        .environment(auth)
        .environment(DataStore(service: DataService(auth: auth)))
}
