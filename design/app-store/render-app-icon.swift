import AppKit
import SwiftUI

@main
struct RenderAppIcon {
    @MainActor
    static func main() throws {
        guard CommandLine.arguments.count == 2 else {
            throw NSError(domain: "RenderAppIcon", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Usage: render-app-icon <output.png>"
            ])
        }
        let renderer = ImageRenderer(content:
            AppIconView()
                .environment(\.colorScheme, .light)
                .frame(width: 1024, height: 1024)
        )
        renderer.scale = 1
        renderer.isOpaque = false
        guard let image = renderer.cgImage,
              let data = NSBitmapImageRep(cgImage: image)
                .representation(using: .png, properties: [:]) else {
            throw NSError(domain: "RenderAppIcon", code: 2, userInfo: [
                NSLocalizedDescriptionKey: "Cannot render AppIconView"
            ])
        }
        try data.write(to: URL(fileURLWithPath: CommandLine.arguments[1]), options: .atomic)
    }
}
