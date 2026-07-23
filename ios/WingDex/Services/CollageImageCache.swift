import Observation
import UIKit

/// Shared in-memory cache for collage tile images, loaded lazily from the bundle.
@MainActor
@Observable
final class CollageImageCache {
    static let shared = CollageImageCache()
    nonisolated static let names = (1...26).map { "collage\($0)" }

    private(set) var images: [String: UIImage] = [:]
    @ObservationIgnored private var loadTask: Task<[String: UIImage], Never>?

    func load() async {
        if images.count == Self.names.count { return }
        if let loadTask {
            images = await loadTask.value
            return
        }

        let task = Task.detached(priority: .utility) {
            var loaded: [String: UIImage] = [:]
            loaded.reserveCapacity(Self.names.count)
            for name in Self.names {
                guard !Task.isCancelled,
                      let url = Bundle.main.url(forResource: name, withExtension: "jpg"),
                      let image = UIImage(contentsOfFile: url.path)
                else { continue }
                loaded[name] = image
            }
            return loaded
        }
        loadTask = task
        images = await task.value
        loadTask = nil
    }
}
