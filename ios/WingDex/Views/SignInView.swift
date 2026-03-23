import AuthenticationServices
import CoreMotion
import SwiftUI

// MARK: - Sign-In Collage Parameters

private let signInTileSize: CGFloat = 175
private let signInSpacing: CGFloat = 5
private let signInAngle: Double = -20
private let signInRows = 6
private let signInCornerRadius: CGFloat = 10
/// 3D tilt angle (degrees) -- tilts the collage "into" the screen
private let signInPerspectiveTilt: Double = 30
private let signInPerspectiveAmount: CGFloat = 1.0
/// How many points the collage shifts per unit of device tilt
private let signInParallaxStrength: CGFloat = 20

// -- Blur overlay parameters (same system as PhotoSelectionView's collageFadeEnd/collageFadeLength) --

/// Where the top blur finishes fading out (fraction from top, 0 = no top blur)
private let signInTopBlurFadeEnd: Double = 0.10
/// How far down the screen photos remains crisp (0 = top only, 1 = full screen)
private let signInBlurFadeEnd: Double = 0.3
/// Blur fade-in length as a fraction of screen height
private let signInBlurFadeLength: Double = 0.4
/// Darkening tint in light mode (0 = none, 1 = solid black). Applied with same mask as blur.
private let signInDarkenLight: Double = 0.1
/// Dark mode multiplier for darkening (stacks on light value)
private let signInDarkenDarkMultiplier: Double = 5

/// Full-screen sign-in view.
struct SignInView: View {
    @Environment(AuthService.self) private var auth
    @Environment(DataStore.self) private var store

    @Environment(\.colorScheme) private var colorScheme

    @State private var isSigningIn = false
    @State private var errorMessage: String?
    @State private var parallaxOffset: CGSize = .zero

    private static let collageImages: [String] = {
        (1...27).compactMap { i in
            let name = "collage\(i)"
            if Bundle.main.url(forResource: name, withExtension: "jpg") != nil { return name }
            return nil
        }
    }()

    var body: some View {
        GeometryReader { geo in
            let screenH = geo.size.height
        ZStack {
            // Base background
            Color.pageBg.ignoresSafeArea()

            // 3D perspective diagonal photo collage -- full screen
            SignInCollage(imageNames: Self.collageImages)
                .offset(parallaxOffset)
                .ignoresSafeArea()

            // Blur + darkening mask (shared shape)
            //
            // Top:    black -> clear over signInTopBlurFadeEnd
            // Middle: clear (unblurred) until signInBlurFadeEnd
            // Bottom: clear -> black over signInBlurFadeLength, then solid black
            let blurMask = VStack(spacing: 0) {
                LinearGradient(
                    colors: [Color.black, .clear],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: screenH * signInTopBlurFadeEnd)

                Color.clear
                    .frame(height: screenH * max(signInBlurFadeEnd - signInTopBlurFadeEnd, 0))

                LinearGradient(
                    colors: [.clear, Color.black],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: screenH * signInBlurFadeLength)

                Color.black
            }

            // Blur layer
            Rectangle()
                .fill(.ultraThinMaterial)
                .environment(\.colorScheme, .dark)
                .mask(blurMask)
                .ignoresSafeArea()

            // Darkening layer -- same mask shape so dark tint follows the blur
            let darkenOpacity = colorScheme == .dark
                ? signInDarkenLight * signInDarkenDarkMultiplier
                : signInDarkenLight
            Color.black
                .mask(blurMask)
                .opacity(darkenOpacity)
                .ignoresSafeArea()

            // Foreground content
            VStack(spacing: 0) {
                // Top bar
                HStack {
                    Image("BirdLogo")
                        .renderingMode(.template)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 36, height: 36)
                        .foregroundStyle(.white)
                    Spacer()
                    #if DEBUG
                    Menu {
                        Button {
                            signIn {
                                try await auth.signInAnonymously()
                                try await store.loadDemoData()
                            }
                        } label: {
                            Label("Try with Demo Data", systemImage: "sparkles")
                        }
                    } label: {
                        Image(systemName: "sparkles")
                            .font(.title3)
                            .foregroundStyle(.white.opacity(0.8))
                    }
                    .menuStyle(.borderlessButton)
                    .buttonStyle(.plain)
                    #endif
                }
                .padding(.horizontal, 28)
                .padding(.top, 8)

                Spacer()

                // Big left-aligned title
                VStack(alignment: .leading, spacing: 8) {
                    Text("Start your")
                        .font(.system(size: 52, weight: .bold, design: .serif))
                    Text("WingDex")
                        .font(.system(size: 52, weight: .bold, design: .serif))
                        .foregroundStyle(Color.accentColor)
                        .environment(\.colorScheme, .dark)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .foregroundStyle(.white)
                .padding(.horizontal, 28)
                .padding(.bottom, 32)

                // Social sign-in buttons
                let btnHeight: CGFloat = 44
                let iconSize: CGFloat = btnHeight * 0.32
                let fontSize: CGFloat = btnHeight * 0.38

                // Glass button styles add ~14pt of chrome padding around the label
                let glassLabelHeight: CGFloat = btnHeight - 14
                VStack(spacing: 12) {
                    // Apple -- native SignInWithAppleButton
                    SignInWithAppleButton(.continue) { request in
                        request.requestedScopes = [.fullName, .email]
                    } onCompletion: { result in
                        signIn {
                            let authorization = try result.get()
                            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
                                throw URLError(.userAuthenticationRequired)
                            }
                            try await auth.signInWithApple(credential: credential)
                        }
                    }
                    .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
                    .id(colorScheme)
                    .frame(height: btnHeight)
                    .clipShape(Capsule())

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
                        .frame(height: glassLabelHeight)
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.glass)

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
                        .frame(height: glassLabelHeight)
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.glass)
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
                Text("By continuing, you accept our [Terms of Use](https://wingdex.app/terms) and [Privacy Policy](https://wingdex.app/privacy).")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.5))
                    .tint(.white.opacity(0.7))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 28)
                    .padding(.top, 4)
                    .padding(.bottom, 8)
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
        .onAppear { startParallax() }
        .onDisappear { stopParallax() }
        }
    }

    // MARK: - Parallax Motion

    private static let motionManager = CMMotionManager()

    private func startParallax() {
        let manager = Self.motionManager
        guard manager.isDeviceMotionAvailable, !manager.isDeviceMotionActive else { return }
        manager.deviceMotionUpdateInterval = 1.0 / 30.0
        manager.startDeviceMotionUpdates(to: .main) { motion, _ in
            guard let gravity = motion?.gravity else { return }
            // gravity.x/y range from -1 to 1, smooth at all orientations (no gimbal lock)
            let clamp = { (v: Double) -> Double in min(max(v, -1), 1) }
            parallaxOffset = CGSize(
                width: clamp(gravity.x) * signInParallaxStrength,
                height: clamp(-gravity.y) * signInParallaxStrength
            )
        }
    }

    private func stopParallax() {
        Self.motionManager.stopDeviceMotionUpdates()
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
            let pitch = signInTileSize + signInSpacing
            let extraWidth = geo.size.height * abs(sin(signInAngle * .pi / 180))
            let tilesPerRow = Int((geo.size.width + extraWidth) / pitch) + 3

            VStack(spacing: signInSpacing) {
                ForEach(0..<signInRows, id: \.self) { row in
                    HStack(spacing: signInSpacing) {
                        if !row.isMultiple(of: 2) {
                            Spacer().frame(width: pitch / 2, height: signInTileSize)
                        }
                        ForEach(0..<tilesPerRow, id: \.self) { col in
                            let index = (row * tilesPerRow + col) % imageNames.count
                            let name = imageNames[index]
                            if let img = Self.loadImage(named: name) {
                                Image(uiImage: img)
                                    .resizable()
                                    .scaledToFill()
                                    .frame(width: signInTileSize, height: signInTileSize)
                                    .clipShape(RoundedRectangle(cornerRadius: signInCornerRadius))
                            }
                        }
                    }
                }
            }
            .drawingGroup()
            .frame(width: geo.size.width + extraWidth)
            .rotationEffect(.degrees(signInAngle))
            .offset(x: -extraWidth / 2, y: -pitch)
            // 3D perspective
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
