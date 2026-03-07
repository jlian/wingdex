import AuthenticationServices
import SwiftUI

/// Full-screen sign-in view matching the web app's auth gate.
///
/// Uses native SwiftUI controls styled to match the web's warm palette:
/// serif heading, 14px body text, 36pt button height, 12pt corner radius.
struct SignInView: View {
    @Environment(AuthService.self) private var auth
    @State private var isSigningIn = false
    @State private var errorMessage: String?
    @State private var mode: AuthMode = .signup

    enum AuthMode {
        case signup, login
    }

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(spacing: 0) {
                    Spacer(minLength: 24)

                    // Bird icon - shared Phosphor bird duotone logo
                    Image("BirdLogo")
                        .renderingMode(.template)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 28, height: 28)
                        .foregroundStyle(Color.accentColor)
                        .padding(.bottom, 24)

                    // Auth controls - vertically stacked with consistent 36pt button height
                    VStack(spacing: 16) {
                        // Header - web: serif 18px semibold + 14px muted terms
                        VStack(spacing: 8) {
                            Text(mode == .signup ? "Sign up" : "Log in")
                                .font(.system(size: 18, weight: .semibold, design: .serif))
                                .foregroundStyle(Color.foregroundText)

                            Text("By continuing you accept our \(Text("Terms of Use").foregroundStyle(Color.accentColor)) and \(Text("Privacy Policy").foregroundStyle(Color.accentColor)).")
                                .font(.system(size: 14))
                                .foregroundStyle(Color.mutedText)
                                .multilineTextAlignment(.center)
                                .fixedSize(horizontal: false, vertical: true)
                        }

                        // Social buttons - web: 36px height, 12px radius, 14px medium
                        VStack(spacing: 12) {
                            // GitHub - outlined
                            Button {
                                signIn { try await auth.signInWithGitHub() }
                            } label: {
                                Label {
                                    Text("Continue with GitHub")
                                        .font(.system(size: 14, weight: .medium))
                                } icon: {
                                    Image(systemName: "chevron.left.forwardslash.chevron.right")
                                        .font(.system(size: 14))
                                }
                                .frame(maxWidth: .infinity, minHeight: 36)
                            }
                            .buttonStyle(.bordered)
                            .tint(Color.foregroundText)

                            // Apple - styled to match other buttons
                            Button {
                                signIn { try await auth.signInWithAppleNative() }
                            } label: {
                                Label {
                                    Text("Continue with Apple")
                                        .font(.system(size: 14, weight: .medium))
                                } icon: {
                                    Image(systemName: "apple.logo")
                                        .font(.system(size: 14))
                                }
                                .frame(maxWidth: .infinity, minHeight: 36)
                            }
                            .buttonStyle(.bordered)
                            .tint(Color.foregroundText)

                            // Google - outlined
                            Button {
                                signIn { try await auth.signInWithGoogle() }
                            } label: {
                                Label {
                                    Text("Continue with Google")
                                        .font(.system(size: 14, weight: .medium))
                                } icon: {
                                    Image(systemName: "globe")
                                        .font(.system(size: 14))
                                }
                                .frame(maxWidth: .infinity, minHeight: 36)
                            }
                            .buttonStyle(.bordered)
                            .tint(Color.foregroundText)
                        }

                        // OR divider - web: 12px uppercase muted text, 1px border line
                        HStack(spacing: 8) {
                            Rectangle()
                                .fill(Color.warmBorder)
                                .frame(height: 1)
                            Text("OR")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(Color.mutedText)
                                .textCase(.uppercase)
                            Rectangle()
                                .fill(Color.warmBorder)
                                .frame(height: 1)
                        }

                        // Passkey - web: primary bg, white text, 14px medium
                        Button {
                            signIn { try await auth.signInWithPasskey() }
                        } label: {
                            Label {
                                Text(mode == .signup ? "Sign up with a Passkey" : "Log in with a Passkey")
                                    .font(.system(size: 14, weight: .medium))
                            } icon: {
                                Image(systemName: "key.fill")
                                    .font(.system(size: 14))
                            }
                            .frame(maxWidth: .infinity, minHeight: 36)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Color.accentColor)

                        // Error
                        if let errorMessage {
                            Text(errorMessage)
                                .font(.system(size: 12))
                                .foregroundStyle(.red)
                                .multilineTextAlignment(.center)
                                .transition(.opacity)
                        }

                        // Mode toggle - matches web's "Already have a WingDex? Log in"
                        Button {
                            withAnimation(.easeInOut(duration: 0.15)) {
                                errorMessage = nil
                                mode = mode == .signup ? .login : .signup
                            }
                        } label: {
                            if mode == .signup {
                                Text("Already have a WingDex? \(Text("Log in").foregroundStyle(Color.accentColor))")
                                    .font(.system(size: 14))
                                    .foregroundStyle(Color.mutedText)
                            } else {
                                Text("New to WingDex? \(Text("Sign up").foregroundStyle(Color.accentColor))")
                                    .font(.system(size: 14))
                                    .foregroundStyle(Color.mutedText)
                            }
                        }
                        .buttonStyle(.plain)

                        #if DEBUG
                        Button {
                            signIn { try await auth.signInAnonymously() }
                        } label: {
                            Label {
                                Text("Try Without Account")
                                    .font(.system(size: 14, weight: .medium))
                            } icon: {
                                Image(systemName: "person.crop.circle.badge.questionmark")
                                    .font(.system(size: 14))
                            }
                            .frame(maxWidth: .infinity, minHeight: 36)
                        }
                        .buttonStyle(.bordered)
                        .tint(Color.mutedText)
                        #endif
                    }
                    .padding(.horizontal, 24)
                    .disabled(isSigningIn)

                    if isSigningIn {
                        ProgressView()
                            .padding(.top, 16)
                    }

                    Spacer(minLength: 24)
                }
                .frame(minHeight: geometry.size.height)
            }
        }
        .background(Color.pageBg.ignoresSafeArea())
    }

    private func signIn(action: @escaping () async throws -> Void) {
        isSigningIn = true
        errorMessage = nil
        Task {
            do {
                try await action()
            } catch let error as ASAuthorizationError where error.code == .notHandled {
                // Code 1004: associated domain not set up for this rpID
                errorMessage = "Passkey not available for this domain. Check Associated Domains entitlement."
            } catch let error as ASAuthorizationError where error.code == .canceled {
                // User cancelled - no error message needed
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

#Preview {
    SignInView()
        .environment(AuthService())
}
