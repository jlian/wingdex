import Foundation
import Observation

enum AppTab: Hashable {
    case home
    case outings
    case wingdex
    case add
}

enum AddPhotosLaunchAction: Equatable {
    case library
    case camera
}

struct AddPhotosLaunchRequest: Equatable {
    let id: UUID
    let action: AddPhotosLaunchAction
}

enum AppRoute: Equatable {
    case home
    case outings
    case wingdex(filter: String? = nil)
    case addPhotos(launchAction: AddPhotosLaunchAction? = nil)
}

@MainActor
@Observable
final class AppNavigationModel {
    static let shared = AppNavigationModel()

    var selectedTab = AppTab.home
    var wingDexFilter = ""
    private(set) var incomingShareRequestID = UUID()
    private(set) var addPhotosLaunchRequest: AddPhotosLaunchRequest?

    private(set) var pendingRoute: AppRoute?
    private var isMainInterfaceReady = false

    func route(to route: AppRoute) {
        guard isMainInterfaceReady else {
            pendingRoute = route
            return
        }
        apply(route)
    }

    func setMainInterfaceReady(_ isReady: Bool) {
        isMainInterfaceReady = isReady
        guard isReady, let pendingRoute else { return }
        self.pendingRoute = nil
        apply(pendingRoute)
    }

    func handleIncomingShare() {
        incomingShareRequestID = UUID()
        route(to: .addPhotos())
    }

    func consumeAddPhotosLaunchRequest(id: UUID) {
        guard addPhotosLaunchRequest?.id == id else { return }
        addPhotosLaunchRequest = nil
    }

    private func apply(_ route: AppRoute) {
        switch route {
        case .home:
            selectedTab = .home
        case .outings:
            selectedTab = .outings
        case .wingdex(let filter):
            wingDexFilter = filter ?? ""
            selectedTab = .wingdex
        case .addPhotos(let launchAction):
            selectedTab = .add
            if let launchAction {
                addPhotosLaunchRequest = AddPhotosLaunchRequest(
                    id: UUID(),
                    action: launchAction
                )
            }
        }
    }
}