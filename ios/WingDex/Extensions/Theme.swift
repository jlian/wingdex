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

    /// Muted secondary text - darker than web's oklch(0.55 0.04 240) for readability on beige
    static let mutedText = Color(red: 70/255, green: 90/255, blue: 105/255)

    /// Foreground text - oklch(0.25 0.02 155) -> rgb(26, 37, 29)
    static let foregroundText = Color(red: 26/255, green: 37/255, blue: 29/255)

    // MARK: - Borders

    /// Warm border - oklch(0.80 0.02 85) -> rgb(196, 189, 176)
    static let warmBorder = Color(red: 196/255, green: 189/255, blue: 176/255)
}

// MARK: - List Cell Appearance

/// Override UICollectionViewListCell to set custom background + highlight colors.
/// Only applies to plain-style lists; Forms/grouped lists keep their default look.
extension UICollectionViewListCell {
    private var isPlainListCell: Bool {
        // Walk up to find the UICollectionView, then check if cell spans full width
        var view: UIView? = superview
        while let v = view {
            if let cv = v as? UICollectionView {
                return frame.width >= cv.bounds.width - 1
            }
            view = v.superview
        }
        return false
    }

    open override func updateConfiguration(using state: UICellConfigurationState) {
        super.updateConfiguration(using: state)
        guard isPlainListCell else { return }
        var bg = UIBackgroundConfiguration.listCell()
        bg.backgroundColor = UIColor(Color.pageBg)
        if state.isHighlighted || state.isSelected {
            bg.backgroundColor = UIColor(Color.foregroundText.opacity(0.08))
        }
        backgroundConfiguration = bg
    }
}

// MARK: - View Modifiers

extension View {
    /// Apply the warm cream page background that fills edge-to-edge.
    func warmBackground() -> some View {
        self
            .background(Color.pageBg)
    }
}

// MARK: - Environment Keys

/// Environment action for triggering the Add Photos flow from any view.
private struct ShowAddPhotosKey: EnvironmentKey {
    nonisolated(unsafe) static let defaultValue: () -> Void = {}
}

extension EnvironmentValues {
    var showAddPhotos: () -> Void {
        get { self[ShowAddPhotosKey.self] }
        set { self[ShowAddPhotosKey.self] = newValue }
    }
}
