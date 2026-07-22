import UIKit

enum AppQuickAction: String {
    case takePhoto = "app.wingdex.quick-action.take-photo"
    case uploadPhotos = "app.wingdex.quick-action.upload-photos"
    case viewWingDex = "app.wingdex.quick-action.view-wingdex"

    var route: AppRoute {
        switch self {
        case .takePhoto: .addPhotos(launchAction: .camera)
        case .uploadPhotos: .addPhotos(launchAction: .library)
        case .viewWingDex: .wingdex()
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        if let shortcutItem = options.shortcutItem {
            AppQuickActionRouter.handle(shortcutItem)
        }
        let configuration = UISceneConfiguration(
            name: "Default Configuration",
            sessionRole: connectingSceneSession.role
        )
        configuration.delegateClass = AppSceneDelegate.self
        return configuration
    }
}

@MainActor
final class AppSceneDelegate: NSObject, UIWindowSceneDelegate {
    func windowScene(
        _ windowScene: UIWindowScene,
        performActionFor shortcutItem: UIApplicationShortcutItem,
        completionHandler: @escaping (Bool) -> Void
    ) {
        AppQuickActionRouter.handle(shortcutItem, completionHandler: completionHandler)
    }
}

private enum AppQuickActionRouter {
    @discardableResult
    static func handle(_ shortcutItem: UIApplicationShortcutItem) -> Bool {
        guard let quickAction = AppQuickAction(rawValue: shortcutItem.type) else { return false }
        Task { @MainActor in
            AppNavigationModel.shared.route(to: quickAction.route)
        }
        return true
    }

    @MainActor
    static func handle(
        _ shortcutItem: UIApplicationShortcutItem,
        completionHandler: @escaping (Bool) -> Void
    ) {
        guard let quickAction = AppQuickAction(rawValue: shortcutItem.type) else {
            completionHandler(false)
            return
        }
        AppNavigationModel.shared.route(to: quickAction.route)
        completionHandler(true)
    }
}