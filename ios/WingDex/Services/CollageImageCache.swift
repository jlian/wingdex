import UIKit

/// Shared in-memory cache for collage tile images, loaded once from the bundle.
enum CollageImageCache {
    static let images: [String: UIImage] = {
        var cache: [String: UIImage] = [:]
        for i in 1...26 {
            let name = "collage\(i)"
            if let url = Bundle.main.url(forResource: name, withExtension: "jpg"),
               let img = UIImage(contentsOfFile: url.path) {
                cache[name] = img
            }
        }
        return cache
    }()

    static let names: [String] = {
        (1...26).compactMap { i in
            let name = "collage\(i)"
            return images[name] != nil ? name : nil
        }
    }()
}
