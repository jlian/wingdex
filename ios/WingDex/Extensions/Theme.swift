import SwiftUI

/// Nature-inspired color palette matching the web app's forest green theme.
///
/// Light mode: warm cream backgrounds, deep forest green primary.
/// Dark mode: deep green-black backgrounds, bright green primary.
extension Color {
    /// Forest green primary - matches web's oklch(0.45 0.08 155) / oklch(0.58 0.10 155)
    /// Used automatically as the tint via AccentColor asset catalog entry.

    /// Warm cream background for light mode cards
    static let warmCream = Color(red: 0.96, green: 0.94, blue: 0.91)

    /// Dark greenish background for dark mode
    static let darkGreen = Color(red: 0.15, green: 0.18, blue: 0.16)
}
