import SwiftUI

/// Reconstructed app icon from Icon Composer layers (sans liquid glass and background).
///
/// Composites the four visible SVG layers with display-P3 gradient fills
/// that match the icon.json fill-specializations for light and dark mode.
struct AppIconView: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ZStack {
            // Body -- gradient fill from icon.json, used as mask over the body SVG shape
            bodyGradient
                .mask {
                    Image("IconBody")
                        .resizable()
                        .scaledToFit()
                }
                .opacity(0.99)

            // Lower wing -- original SVG gradient (no fill-specialization override)
            Image("IconLowerWing")
                .resizable()
                .scaledToFit()
                .opacity(0.95)

            // Upper wing -- original SVG gradient (no fill-specialization override)
            Image("IconUpperWing")
                .resizable()
                .scaledToFit()
                .opacity(0.95)

            // Eye -- solid fill from icon.json
            eyeColor
                .mask {
                    Image("IconEye")
                        .resizable()
                        .scaledToFit()
                }
                .opacity(0.85)
        }
        .aspectRatio(1, contentMode: .fit)
    }

    // MARK: - Fill colors from icon.json fill-specializations

    /// Body gradient matching icon.json orientation (top-center → 70% down).
    ///
    /// Light: automatic-gradient approximated from the tinted linear-gradient values.
    /// Dark: explicit linear-gradient (display-P3 yellow-green → sRGB green).
    private var bodyGradient: LinearGradient {
        if colorScheme == .dark {
            LinearGradient(
                colors: [
                    Color(.displayP3, red: 0.945, green: 0.988, blue: 0.733),
                    Color(red: 0.467, green: 0.698, blue: 0.506)
                ],
                startPoint: UnitPoint(x: 0.5, y: 0),
                endPoint: UnitPoint(x: 0.5, y: 0.691)
            )
        } else {
            LinearGradient(
                colors: [
                    Color(.displayP3, red: 0.603, green: 0.797, blue: 0.636),
                    Color(.displayP3, red: 0.467, green: 0.698, blue: 0.506)
                ],
                startPoint: UnitPoint(x: 0.5, y: 0),
                endPoint: UnitPoint(x: 0.5, y: 0.7)
            )
        }
    }

    /// Eye color: cream (light) or dark green (dark).
    private var eyeColor: Color {
        colorScheme == .dark
            ? Color(red: 0.090, green: 0.224, blue: 0.141)
            : Color(.displayP3, red: 0.949, green: 0.933, blue: 0.888)
    }
}

#if DEBUG
#Preview("Light") {
    AppIconView()
        .frame(width: 120, height: 120)
        .preferredColorScheme(.light)
}

#Preview("Dark") {
    AppIconView()
        .frame(width: 120, height: 120)
        .preferredColorScheme(.dark)
}
#endif
