import AppKit
import Foundation

struct Edit: Decodable {
    struct Preview: Decodable {
        struct Section: Decodable {
            enum Style: String, Decodable { case chapter, brand }
            let title: String
            let style: Style?
        }
        let sections: [Section]
    }
    let previews: [Preview]
}

struct TitleCardError: Error { let message: String }

@main
struct TitleCards {
    @MainActor
    static func main() throws {
        guard (3...4).contains(CommandLine.arguments.count) else {
            throw TitleCardError(message: "Usage: title-cards <edit.json> <output-directory> [icon.png]")
        }
        let edit = try JSONDecoder().decode(
            Edit.self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
        )
        let directory = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let iconURL = CommandLine.arguments.count == 4
            ? URL(fileURLWithPath: CommandLine.arguments[3])
            : URL(fileURLWithPath: #filePath).deletingLastPathComponent()
                .appendingPathComponent("app-icon.png")
        guard let icon = NSImage(contentsOf: iconURL) else {
            throw TitleCardError(message: "Cannot load app icon: \(iconURL.path)")
        }
        guard let font = NSFont(name: "Georgia", size: 96),
              let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) else {
            throw TitleCardError(message: "Missing font or color space")
        }
        let forest = NSColor(srgbRed: 23 / 255, green: 61 / 255, blue: 44 / 255, alpha: 1)
        let cream = NSColor(srgbRed: 245 / 255, green: 239 / 255, blue: 223 / 255, alpha: 1)
        let leaf = NSColor(srgbRed: 220 / 255, green: 229 / 255, blue: 214 / 255, alpha: 1)
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = 6
        for (previewIndex, preview) in edit.previews.enumerated() {
            for (sectionIndex, section) in preview.sections.enumerated() {
                guard let context = CGContext(
                    data: nil, width: 886, height: 1920, bitsPerComponent: 8,
                    bytesPerRow: 0, space: colorSpace,
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                ) else { throw TitleCardError(message: "Cannot create title card") }
                NSGraphicsContext.saveGraphicsState()
                NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
                cream.setFill()
                NSRect(x: 0, y: 0, width: 886, height: 1920).fill()
                leaf.setFill()
                NSBezierPath(ovalIn: NSRect(x: -300, y: -1050, width: 1500, height: 1850)).fill()
                let attributes: [NSAttributedString.Key: Any] = [
                    .font: font, .foregroundColor: forest, .paragraphStyle: paragraph, .kern: -2,
                ]
                for line in section.title.components(separatedBy: "\n") {
                    guard NSAttributedString(string: line, attributes: attributes).size().width <= 726 else {
                        throw TitleCardError(message: "Title line is too wide: \(line)")
                    }
                }
                let title = NSAttributedString(string: section.title, attributes: attributes)
                let bounds = title.boundingRect(
                    with: NSSize(width: 726, height: 1000), options: [.usesLineFragmentOrigin]
                )
                guard bounds.height <= 350 else { throw TitleCardError(message: "Title is too tall") }
                let isBrand = section.style == .brand
                let iconRect = isBrand
                    ? NSRect(x: 283, y: 1030, width: 320, height: 320)
                    : NSRect(x: 80, y: 1210, width: 100, height: 100)
                NSGraphicsContext.saveGraphicsState()
                NSBezierPath(
                    roundedRect: iconRect,
                    xRadius: iconRect.width * 0.225, yRadius: iconRect.height * 0.225
                ).addClip()
                NSGraphicsContext.current?.imageInterpolation = .high
                icon.draw(in: iconRect)
                NSGraphicsContext.restoreGraphicsState()
                if isBrand {
                    let centered = NSMutableParagraphStyle()
                    centered.alignment = .center
                    centered.lineSpacing = paragraph.lineSpacing
                    var centeredAttributes = attributes
                    centeredAttributes[.paragraphStyle] = centered
                    NSAttributedString(string: section.title, attributes: centeredAttributes)
                        .draw(with: NSRect(x: 80, y: 580, width: 726, height: 350),
                              options: [.usesLineFragmentOrigin])
                } else {
                    title.draw(with: NSRect(x: 80, y: 800, width: 726, height: 350),
                               options: [.usesLineFragmentOrigin])
                }
                NSGraphicsContext.restoreGraphicsState()
                guard let image = context.makeImage(),
                      let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
                    throw TitleCardError(message: "Cannot encode title card")
                }
                let name = "preview-title-\(previewIndex)-\(sectionIndex).png"
                try data.write(to: directory.appendingPathComponent(name), options: .atomic)
            }
        }
    }
}
