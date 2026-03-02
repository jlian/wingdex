import SwiftUI

/// Nature-inspired color palette matching the web app's forest green theme.
///
/// Web colors (OKLCH -> sRGB approximations):
///   Light background:  oklch(0.88 0.03 85)  -> warm beige
///   Light card:        oklch(0.97 0.01 85)  -> near-white cream
///   Dark background:   oklch(0.18 0.02 155) -> dark forest
///   Dark card:         oklch(0.22 0.02 155) -> darker card
///   Primary:           oklch(0.45 0.08 155) -> forest green
///   Dark primary:      oklch(0.58 0.10 155) -> bright green
///   Muted text:        oklch(0.55 0.04 240) -> blue-gray
///   Border:            oklch(0.80 0.02 85)  -> warm border
extension Color {
    // MARK: - Backgrounds

    /// Warm beige page background - oklch(0.88 0.03 85)
    static let pageBg = Color("PageBackground")

    /// Card/surface background - oklch(0.97 0.01 85)
    static let cardBg = Color("CardBackground")

    // MARK: - Text

    /// Muted secondary text - oklch(0.55 0.04 240)
    static let mutedText = Color(red: 0.42, green: 0.46, blue: 0.55)

    // MARK: - Borders

    /// Warm cream border - oklch(0.80 0.02 85)
    static let warmBorder = Color(red: 0.76, green: 0.75, blue: 0.73)
}

// MARK: - View Modifiers

extension View {
    /// Apply the warm cream page background that fills edge-to-edge.
    func warmBackground() -> some View {
        self
            .background(Color.pageBg)
    }
}
