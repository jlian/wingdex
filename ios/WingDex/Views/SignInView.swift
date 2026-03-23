import AuthenticationServices
import SwiftUI

// MARK: - Sign-In Collage Parameters

private let signInTileWidth: CGFloat = 175
private let signInTileHeight: CGFloat = 175
private let signInSpacing: CGFloat = 5
private let signInAngle: Double = -20
private let signInRows = 6
private let signInCornerRadius: CGFloat = 10
private let signInOpacity: Double = 0.9
/// 3D tilt angle (degrees) -- tilts the collage "into" the screen
private let signInPerspectiveTilt: Double = 30
private let signInPerspectiveAmount: CGFloat = 1.0

/// Full-screen sign-in view.
struct SignInView: View {
    @Environment(AuthService.self) private var auth
    @Environment(DataStore.self) private var store

    @Environment(\.colorScheme) private var colorScheme

    @State private var isSigningIn = false
    @State private var errorMessage: String?

    private static let collageImages: [String] = {
        (1...27).compactMap { i in
            let name = "collage\(i)"
            if Bundle.main.url(forResource: name, withExtension: "jpg") != nil { return name }
            return nil
        }
    }()

    var body: some View {
        ZStack {
            // Base background
            Color.pageBg.ignoresSafeArea()

            // 3D perspective diagonal photo collage -- full screen
            SignInCollage(imageNames: Self.collageImages)
                .overlay {
                    Color.black.opacity(0.45)
                }
                .ignoresSafeArea()

            // Foreground content
            VStack(spacing: 0) {
                Spacer()

                // Big left-aligned title
                VStack(alignment: .leading, spacing: 8) {
                    Text("Start your")
                        .font(.system(size: 52, weight: .bold, design: .serif))
                    Text("WingDex")
                        .font(.system(size: 52, weight: .bold, design: .serif))
                        .foregroundStyle(Color.accentColor)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.6), radius: 4, x: 0, y: 2)
                .padding(.horizontal, 28)
                .padding(.bottom, 32)

                // Social sign-in buttons
                let btnHeight: CGFloat = 44
                let iconSize: CGFloat = btnHeight * 0.30
                let fontSize: CGFloat = btnHeight * 0.36

                // Glass button styles add ~14pt of chrome padding around the label
                let glassLabelHeight: CGFloat = btnHeight - 14
                VStack(spacing: 12) {
                    // Apple -- native SwiftUI button; overlay intercepts tap for our auth flow
                    SignInWithAppleButton(.continue) { _ in } onCompletion: { _ in }
                    .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
                    .id(colorScheme)
                    .frame(height: btnHeight)
                    .clipShape(Capsule())
                    .allowsHitTesting(false)
                    .overlay {
                        Color.clear
                            .contentShape(Rectangle())
                            .onTapGesture { signIn { try await auth.signInWithAppleNative() } }
                    }

                    // Google -- neutral style per branding guidelines
                    Button {
                        signIn { try await auth.signInWithGoogle() }
                    } label: {
                        HStack(spacing: 6) {
                            Image("GoogleIcon")
                                .resizable()
                                .scaledToFit()
                                .frame(width: iconSize, height: iconSize)
                            Text("Continue with Google")
                                .font(.system(size: fontSize, weight: .medium))
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: btnHeight)
                        .foregroundStyle(Color(red: 0.12, green: 0.12, blue: 0.12))
                        .background(Color(red: 0.95, green: 0.95, blue: 0.95))
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)

                    // GitHub -- neutral style matching Google
                    Button {
                        signIn { try await auth.signInWithGitHub() }
                    } label: {
                        HStack(spacing: 6) {
                            Image("GitHubIcon")
                                .renderingMode(.template)
                                .resizable()
                                .scaledToFit()
                                .frame(width: iconSize, height: iconSize)
                            Text("Continue with GitHub")
                                .font(.system(size: fontSize, weight: .medium))
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: btnHeight)
                        .foregroundStyle(Color(red: 0.12, green: 0.12, blue: 0.12))
                        .background(Color(red: 0.95, green: 0.95, blue: 0.95))
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 28)

                // OR divider
                HStack(spacing: 8) {
                    Rectangle().fill(.white.opacity(0.2)).frame(height: 1)
                    Text("OR")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.white.opacity(0.5))
                    Rectangle().fill(.white.opacity(0.2)).frame(height: 1)
                }
                .padding(.horizontal, 28)
                .padding(.vertical, 16)

                // Passkey section
                VStack(spacing: 12) {
                    Label("Continue with a Passkey", systemImage: "person.badge.key.fill")
                        .font(.system(size: fontSize, weight: .medium))
                        .foregroundStyle(.white)

                    HStack(spacing: 12) {
                        Button {
                            signIn { try await auth.signInWithPasskey() }
                        } label: {
                            Text("Log in")
                                .font(.system(size: fontSize, weight: .medium))
                                .frame(height: glassLabelHeight)
                        }
                        .buttonStyle(.glassProminent)
                        .buttonSizing(.flexible)

                        Button {
                            signIn { try await auth.signUpWithPasskey() }
                        } label: {
                            Text("Sign up")
                                .font(.system(size: fontSize, weight: .medium))
                                .frame(height: glassLabelHeight)
                        }
                        .buttonStyle(.glass)
                        .buttonSizing(.flexible)
                    }
                }
                .padding(16)
                .background(
                    RoundedRectangle(cornerRadius: 22)
                        .fill(.ultraThinMaterial)
                        .environment(\.colorScheme, .dark)
                )
                .padding(.horizontal, 28)

                // Error message (stable layout)
                Text(errorMessage ?? " ")
                    .font(.caption)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .opacity(errorMessage != nil ? 1 : 0)
                    .accessibilityHidden(errorMessage == nil)
                    .padding(.top, 8)

                // Legal text
                Text("By continuing you accept our [Terms of Use](https://wingdex.app/terms) and [Privacy Policy](https://wingdex.app/privacy).")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.5))
                    .tint(.white.opacity(0.7))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 28)
                    .padding(.top, 4)

                Spacer()

                // Debug-only demo data
                #if DEBUG
                Button {
                    signIn {
                        try await auth.signInAnonymously()
                        try await store.loadDemoData()
                    }
                } label: {
                    Label("Try with Demo Data", systemImage: "sparkles")
                        .font(.subheadline.weight(.medium))
                }
                .buttonStyle(.borderless)
                .tint(.white.opacity(0.7))
                .padding(.bottom, 16)
                #endif
            }
        }
        .disabled(isSigningIn)
        .overlay {
            if isSigningIn {
                ProgressView()
                    .frame(maxHeight: .infinity, alignment: .bottom)
                    .padding(.bottom, 40)
            }
        }
        .animation(.default, value: errorMessage)
    }

    // MARK: - Sign-In Handler

    private func signIn(action: @escaping () async throws -> Void) {
        isSigningIn = true
        errorMessage = nil
        Task {
            do {
                try await action()
            } catch let error as ASAuthorizationError where error.code == .notHandled {
                errorMessage = "Passkey not available for this domain. Check Associated Domains entitlement."
            } catch let error as ASAuthorizationError where error.code == .canceled {
                errorMessage = nil
            } catch {
                errorMessage = error.localizedDescription
                #if DEBUG
                print("[SignIn] Error: \(error)")
                #endif
            }
            isSigningIn = false
        }
    }
}

// MARK: - 3D Perspective Photo Collage

/// Diagonal photo grid with 3D perspective tilt for a cinematic background.
private struct SignInCollage: View {
    let imageNames: [String]

    var body: some View {
        GeometryReader { geo in
            let xPitch = signInTileWidth + signInSpacing
            let yPitch = signInTileHeight + signInSpacing
            let extraWidth = geo.size.height * abs(sin(signInAngle * .pi / 180))
            let tilesPerRow = Int((geo.size.width + extraWidth) / xPitch) + 3

            VStack(spacing: signInSpacing) {
                ForEach(0..<signInRows, id: \.self) { row in
                    HStack(spacing: signInSpacing) {
                        if !row.isMultiple(of: 2) {
                            Spacer().frame(width: xPitch / 2, height: signInTileHeight)
                        }
                        ForEach(0..<tilesPerRow, id: \.self) { col in
                            let index = (row * tilesPerRow + col) % imageNames.count
                            let name = imageNames[index]
                            if let img = Self.loadImage(named: name) {
                                Image(uiImage: img)
                                    .resizable()
                                    .scaledToFill()
                                    .frame(width: signInTileWidth, height: signInTileHeight)
                                    .clipShape(RoundedRectangle(cornerRadius: signInCornerRadius))
                            }
                        }
                    }
                }
            }
            .drawingGroup()
            .frame(width: geo.size.width + extraWidth)
            .rotationEffect(.degrees(signInAngle))
            .offset(x: -extraWidth / 2, y: -yPitch)
            .opacity(signInOpacity)
            // 3D perspective -- right side recedes, left side comes forward
            .rotation3DEffect(
                .degrees(signInPerspectiveTilt),
                axis: (x: 1, y: 1, z: -0.5),
                anchor: .center,
                perspective: signInPerspectiveAmount
            )
        }
    }

    private static func loadImage(named name: String) -> UIImage? {
        guard let url = Bundle.main.url(forResource: name, withExtension: "jpg"),
              let img = UIImage(contentsOfFile: url.path) else { return nil }
        return img
    }
}

#if DEBUG
#Preview {
    SignInView()
        .environment(AuthService())
        .environment(previewStore(empty: true))
}
#endif
