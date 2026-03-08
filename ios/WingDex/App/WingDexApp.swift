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
    @State private var showingSettings = false

    enum AppTab: Hashable {
        case home, outings, wingdex, add
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            TabSection {
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

            Tab(value: AppTab.add, role: .search) {
                AddPhotosFlow()
            } label: {
                Label("Add", systemImage: "camera.fill")
            }
        }
        .sheet(isPresented: $showingSettings) {
            SettingsView()
        }
        .environment(\.showAddPhotos) { selectedTab = .add }
    }

    /// Avatar toolbar item - always the rightmost item in the nav bar.
    /// Child views add their sort menus via separate toolbar items which
    /// stack to the left of this one.
    private var avatarToolbarItem: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button {
                showingSettings = true
            } label: {
                AvatarView(imageURL: auth.userImage, name: auth.userName, size: 28)
            }
            .buttonStyle(.plain)
        }
    }

}

/// Renders a user avatar - emoji (from SVG data URL), remote image, or fallback initial.
struct AvatarView: View {
    let imageURL: String?
    let name: String?
    let size: CGFloat

    private var emojiInfo: (emoji: String, color: Color)? {
        guard let url = imageURL,
              url.hasPrefix("data:image/svg+xml") else { return nil }
        let decoded = url.removingPercentEncoding ?? url
        let emojiMap: [(String, Color)] = [
            ("🐦", Color(red: 0.88, green: 0.95, blue: 1.0)),
            ("🦉", Color(red: 1.0, green: 0.95, blue: 0.88)),
            ("🦜", Color(red: 0.88, green: 1.0, blue: 0.93)),
            ("🐧", Color(red: 0.93, green: 0.94, blue: 0.96)),
            ("🦆", Color(red: 0.88, green: 0.98, blue: 0.96)),
            ("🦩", Color(red: 1.0, green: 0.91, blue: 0.95)),
            ("🦅", Color(red: 1.0, green: 0.95, blue: 0.90)),
            ("🐤", Color(red: 1.0, green: 0.98, blue: 0.88)),
        ]
        for (emoji, color) in emojiMap {
            if decoded.contains(emoji) { return (emoji, color) }
        }
        return nil
    }

    var body: some View {
        if let info = emojiInfo {
            Text(info.emoji)
                .font(.system(size: size * 0.6))
                .minimumScaleFactor(0.5)
                .frame(width: size, height: size)
                .background(info.color)
                .clipShape(Circle())
        } else if let image = imageURL, !image.isEmpty,
                  let url = URL(string: image) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let img):
                    img.resizable()
                        .scaledToFill()
                        .frame(width: size, height: size)
                        .clipShape(Circle())
                default:
                    fallbackView
                }
            }
        } else {
            fallbackView
        }
    }

    private var fallbackView: some View {
        Group {
            if let initial = name?.first {
                Text(String(initial).uppercased())
                    .font(.system(size: size * 0.45, weight: .medium))
                    .foregroundStyle(Color.mutedText)
                    .frame(width: size, height: size)
                    .background(Color.mutedText.opacity(0.15))
                    .clipShape(Circle())
            } else {
                Image(systemName: "person.circle.fill")
                    .font(.system(size: size * 0.8))
                    .foregroundStyle(Color.mutedText)
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
