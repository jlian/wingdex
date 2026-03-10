import Foundation

/// Bird-themed nickname generator and emoji avatar system.
/// Ported from `src/lib/fun-names.ts` in the web app.
enum FunNames {

    // MARK: - Word Lists

    private static let adjectives = [
        "bold", "brave", "bright", "brisk", "calm", "cheerful", "clever",
        "cozy", "cosmic", "crafty", "crisp", "curious", "daring", "dazzling",
        "eager", "earnest", "fancy", "fearless", "feisty", "fierce", "fleet",
        "gentle", "gleeful", "golden", "grand", "happy", "hardy", "hasty",
        "hearty", "hidden", "humble", "hushed", "jolly", "keen", "kind",
        "lively", "lone", "lucky", "merry", "mighty", "nimble", "noble",
        "pale", "patient", "plucky", "proud", "quick", "quiet", "rosy",
        "rustic", "sage", "savvy", "scrappy", "secret", "shrewd", "shy",
        "silent", "sleek", "sneaky", "snug", "spry", "steady", "stout",
        "swift", "tender", "tiny", "vivid", "warm", "wary", "watchful",
        "whimsy", "wild", "wily", "wise", "witty", "zappy", "zesty",
        "dank",
    ]

    private static let modifiers = [
        "alpine", "arctic", "autumn", "bamboo", "canyon", "cedar", "cliff",
        "cloud", "coastal", "coral", "creek", "crystal", "dawn", "delta",
        "desert", "drift", "dune", "dusky", "elm", "fern", "field", "fir",
        "fjord", "forest", "frost", "garden", "glacier", "glen", "grove",
        "harbor", "heath", "hedge", "highland", "hollow", "island", "ivy",
        "jungle", "kelp", "lake", "linden", "maple", "marsh", "meadow",
        "mesa", "mist", "misty", "moon", "moss", "mountain", "oak", "ocean",
        "palm", "peak", "pebble", "pine", "pond", "prairie", "rain", "reef",
        "ridge", "river", "sage", "shore", "sky", "slate", "snow", "spring",
        "spruce", "star", "stone", "storm", "stream", "summit", "sunset",
        "thorn", "tide", "trail", "tundra", "valley", "vine", "willow",
    ]

    private static let birds = [
        "bunting", "cardinal", "crane", "dove", "eagle", "egret", "falcon",
        "finch", "flamingo", "grouse", "hawk", "heron", "ibis", "jay",
        "kestrel", "kinglet", "lark", "loon", "magpie", "merlin", "osprey",
        "owl", "parrot", "pelican", "penguin", "pipit", "plover", "quail",
        "raven", "robin", "sparrow", "starling", "stork", "swift", "tanager",
        "tern", "thrush", "toucan", "warbler", "wren",
    ]

    private static let birdEmojiMap: [String: String] = [
        "eagle": "🦅", "falcon": "🦅", "hawk": "🦅", "kestrel": "🦅", "merlin": "🦅", "osprey": "🦅",
        "owl": "🦉",
        "parrot": "🦜", "toucan": "🦜", "tanager": "🦜", "jay": "🦜", "magpie": "🦜",
        "penguin": "🐧",
        "loon": "🦆", "grouse": "🦆", "quail": "🦆", "plover": "🦆", "dove": "🦆",
        "flamingo": "🦩", "ibis": "🦩", "egret": "🦩", "heron": "🦩", "stork": "🦩", "crane": "🦩", "pelican": "🦩",
        "finch": "🐤", "sparrow": "🐤", "wren": "🐤", "warbler": "🐤", "bunting": "🐤", "pipit": "🐤", "kinglet": "🐤", "robin": "🐤",
        "cardinal": "🐦", "lark": "🐦", "raven": "🐦", "starling": "🐦", "swift": "🐦", "tern": "🐦", "thrush": "🐦",
    ]

    // MARK: - Public API

    /// The 8 emoji options for avatar selection, matching the web app.
    static let emojiOptions: [String] = ["🐦", "🦉", "🦜", "🐧", "🦆", "🦩", "🦅", "🐤"]

    /// Generate a random kebab-case bird name like "sneaky-meadow-warbler".
    static func generateBirdName() -> String {
        let a = adjectives.randomElement()!
        let m = modifiers.randomElement()!
        let b = birds.randomElement()!
        return "\(a)-\(m)-\(b)"
    }

    /// Return the emoji that best matches the bird word in a kebab-case name.
    static func emojiForBirdName(_ name: String) -> String {
        let lastWord = name.split(separator: "-").last.map(String.init) ?? ""
        return birdEmojiMap[lastWord] ?? "🐦"
    }

    /// Generate an SVG data URL for an emoji avatar, matching the web format.
    /// Uses the same encoding as JavaScript's `encodeURIComponent()` to ensure
    /// the stored value matches between web and iOS.
    static func emojiAvatarDataUrl(_ emoji: String) -> String {
        let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><text x=\"50%\" y=\"54%\" dominant-baseline=\"central\" text-anchor=\"middle\" font-size=\"48\">\(emoji)</text></svg>"
        // Match JS encodeURIComponent: encode everything except A-Z a-z 0-9 - _ . ! ~ * ' ( )
        var allowed = CharacterSet()
        allowed.insert(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")
        return "data:image/svg+xml;utf8," + (svg.addingPercentEncoding(withAllowedCharacters: allowed) ?? svg)
    }

    /// Check if an image URL is an emoji avatar data URL.
    static func isEmojiAvatarDataUrl(_ value: String?) -> Bool {
        value?.hasPrefix("data:image/svg+xml") == true
    }
}
