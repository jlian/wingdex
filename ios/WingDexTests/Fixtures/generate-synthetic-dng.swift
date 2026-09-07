import Foundation
import ImageIO

// Generated Bayer samples only. No photograph, embedded JPEG, time or GPS.
// ImageIO rejects an otherwise identical 256x192 sensor; 512x384 decodes.
func syntheticDNG(width: UInt32 = 512, height: UInt32 = 384, orientation: UInt16 = 6) -> Data {
    func le<T: FixedWidthInteger>(_ value: T) -> Data {
        var value = value.littleEndian
        return withUnsafeBytes(of: &value) { Data($0) }
    }
    var entries: [(UInt16, UInt16, UInt32, Data)] = []
    func short(_ tag: UInt16, _ value: UInt16) { entries.append((tag, 3, 1, le(value))) }
    func long(_ tag: UInt16, _ value: UInt32) { entries.append((tag, 4, 1, le(value))) }
    func ascii(_ tag: UInt16, _ value: String) {
        let bytes = Data(value.utf8) + Data([0])
        entries.append((tag, 2, UInt32(bytes.count), bytes))
    }
    func rationals(_ tag: UInt16, _ values: [UInt32]) {
        entries.append((tag, 5, UInt32(values.count), values.reduce(into: Data()) {
            $0 += le($1) + le(UInt32(1))
        }))
    }
    long(254, 0)
    long(256, width); long(257, height)
    short(258, 16); short(259, 1); short(262, 32803)
    ascii(271, "WingDex"); ascii(272, "Synthetic Bayer")
    long(273, 0); short(274, orientation); short(277, 1)
    long(278, height); long(279, width * height * 2); short(284, 1)
    entries.append((33421, 3, 2, le(UInt16(2)) + le(UInt16(2))))
    entries.append((33422, 1, 4, Data([0, 1, 1, 2])))
    entries.append((50706, 1, 4, Data([1, 4, 0, 0])))
    entries.append((50707, 1, 4, Data([1, 1, 0, 0])))
    ascii(50708, "WingDex Synthetic Bayer")
    entries.append((50710, 1, 3, Data([0, 1, 2])))
    short(50711, 1)
    rationals(50714, [0])
    long(50717, 65535)
    rationals(50718, [1, 1])
    entries.append((50719, 4, 2, le(UInt32(0)) + le(UInt32(0))))
    entries.append((50720, 4, 2, le(width) + le(height)))
    var matrix = Data()
    for value: Int32 in [1, 0, 0, 0, 1, 0, 0, 0, 1] {
        matrix += le(value) + le(Int32(1))
    }
    entries.append((50721, 10, 9, matrix))
    rationals(50728, [1, 1, 1])
    short(50778, 21)
    entries.sort { $0.0 < $1.0 }
    let dataStart = UInt32(8 + 2 + entries.count * 12 + 4)
    var payload = Data()
    var directory = le(UInt16(entries.count))
    for (tag, type, count, value) in entries {
        directory += le(tag) + le(type) + le(count)
        if value.count <= 4 {
            directory += value + Data(repeating: 0, count: 4 - value.count)
        } else {
            directory += le(dataStart + UInt32(payload.count))
            payload += value
            if payload.count % 2 != 0 { payload.append(0) }
        }
    }
    directory += le(UInt32(0))
    let pixelOffset = dataStart + UInt32(payload.count)
    let stripEntry = entries.firstIndex { $0.0 == 273 }!
    directory.replaceSubrange((2 + stripEntry * 12 + 8)..<(2 + stripEntry * 12 + 12), with: le(pixelOffset))
    var pixels = Data()
    for y in 0..<height {
        for x in 0..<width {
            let channel = [0, 1, 1, 2][Int((y % 2) * 2 + x % 2)]
            let values = [(x + 1) * 50000 / width, (y + 1) * 50000 / height, 20000]
            pixels += le(UInt16(values[channel]))
        }
    }
    return Data([0x49, 0x49, 42, 0]) + le(UInt32(8)) + directory + payload + pixels
}

let width: UInt32 = 512
let height: UInt32 = 384
let bytes = syntheticDNG(width: width, height: height)
let url = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .appendingPathComponent("synthetic-bayer.dng")
try bytes.write(to: url)
let options: CFDictionary = [
    kCGImageSourceCreateThumbnailFromImageAlways: true,
    kCGImageSourceCreateThumbnailWithTransform: true,
    kCGImageSourceThumbnailMaxPixelSize: 128,
] as CFDictionary
for (name, source) in [
    ("URL", CGImageSourceCreateWithURL(url as CFURL, nil)),
    ("Data", CGImageSourceCreateWithData(bytes as CFData, nil)),
] {
    guard let source else { print("\(name): no source"); continue }
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, options)
    print("\(width)x\(height) \(name): \(CGImageSourceGetType(source)!), image=\(image?.width ?? 0)x\(image?.height ?? 0), thumbnail=\(thumbnail?.width ?? 0)x\(thumbnail?.height ?? 0)")
}
