@testable import WingDex
import XCTest

final class FunNamesTests: XCTestCase {

    func testGenerateBirdNameIsNotEmpty() {
        let name = FunNames.generateBirdName()
        XCTAssertFalse(name.isEmpty, "Generated bird name should not be empty")
    }

    func testGenerateBirdNameIsHyphenatedFormat() {
        let name = FunNames.generateBirdName()
        let parts = name.split(separator: "-")
        XCTAssertGreaterThanOrEqual(parts.count, 2, "Bird name should be hyphenated, got: \(name)")
    }

    func testEmojiForBirdNameReturnsEmoji() {
        let name = FunNames.generateBirdName()
        let emoji = FunNames.emojiForBirdName(name)
        XCTAssertFalse(emoji.isEmpty, "Should return an emoji for any bird name")
    }

    func testEmojiAvatarDataUrlIsSVG() {
        let emoji = FunNames.emojiForBirdName("Curious Pelican")
        let dataUrl = FunNames.emojiAvatarDataUrl(emoji)
        XCTAssertTrue(dataUrl.hasPrefix("data:image/svg+xml"), "Avatar should be an SVG data URL")
        XCTAssertTrue(dataUrl.contains(emoji) || dataUrl.contains("%"), "Avatar should contain the emoji (possibly encoded)")
    }

    func testEmojiOptionsIsNotEmpty() {
        XCTAssertFalse(FunNames.emojiOptions.isEmpty, "Should have emoji options")
    }

    func testPasskeyLabelFormat() {
        let birdName = FunNames.generateBirdName()
        let deviceModel = "iPhone"
        let label = "\(deviceModel) (\(birdName))"

        // Should match the web's "Device (DisplayName)" format
        let regex = try! NSRegularExpression(pattern: #"^.+ \(.+\)$"#)
        let range = NSRange(label.startIndex..., in: label)
        XCTAssertNotNil(regex.firstMatch(in: label, range: range),
                        "Passkey label should be 'Device (Name)' format, got: \(label)")
    }

    func testGeneratedNamesAreRandomized() {
        // Generate several names and verify we get at least 2 unique ones
        let names = (0..<10).map { _ in FunNames.generateBirdName() }
        let unique = Set(names)
        XCTAssertGreaterThan(unique.count, 1, "Generated names should vary")
    }
}
