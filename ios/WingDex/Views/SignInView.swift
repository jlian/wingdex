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

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

                    // Bird icon
                    Image("BirdLogo")
                        .renderingMode(.template)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 28, height: 28)
                        .foregroundStyle(Color.accentColor)
                        .padding(.bottom, 24)

                    VStack(spacing: 16) {
                        // Header
                        VStack(spacing: 8) {
                            Text("Start your WingDex")
                                .font(.system(size: 18, weight: .semibold, design: .serif))
                                .foregroundStyle(Color.foregroundText)

                            Text("By continuing you accept our \(Text("Terms of Use").foregroundStyle(Color.accentColor)) and \(Text("Privacy Policy").foregroundStyle(Color.accentColor)).")
                                .font(.system(size: 14))
                                .foregroundStyle(Color.mutedText)
                                .multilineTextAlignment(.center)
                                .fixedSize(horizontal: false, vertical: true)
                        }

                        // Social buttons
                        VStack(spacing: 12) {
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

                        // OR divider
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

                        // Passkey section - bordered container matching web
                        VStack(spacing: 12) {
                            Label {
                                Text("Continue with a Passkey")
                                    .font(.system(size: 14, weight: .medium))
                            } icon: {
                                Image(systemName: "key.fill")
                                    .font(.system(size: 14))
                            }
                            .foregroundStyle(Color.foregroundText)

                            HStack(spacing: 12) {
                                Button {
                                    signIn { try await auth.signInWithPasskey() }
                                } label: {
                                    Text("Log in")
                                        .font(.system(size: 14, weight: .medium))
                                        .frame(maxWidth: .infinity, minHeight: 36)
                                }
                                .buttonStyle(.borderedProminent)
                                .tint(Color.accentColor)

                                Button {
                                    signIn { try await auth.signInWithPasskey() }
                                } label: {
                                    Text("Sign up")
                                        .font(.system(size: 14, weight: .medium))
                                        .frame(maxWidth: .infinity, minHeight: 36)
                                }
                                .buttonStyle(.bordered)
                                .tint(Color.foregroundText)
                            }
                        }
                        .padding(12)
                        .background(
                            RoundedRectangle(cornerRadius: 10)
                                .fill(Color.mutedText.opacity(0.06))
                                .stroke(Color.warmBorder.opacity(0.7), lineWidth: 1)
                        )

                        // Error
                        if let errorMessage {
                            Text(errorMessage)
                                .font(.system(size: 12))
                                .foregroundStyle(.red)
                                .multilineTextAlignment(.center)
                                .transition(.opacity)
                        }

                        #if DEBUG
                        // Demo data button
                        Button {
                            signIn {
                                try await auth.signInAnonymously()
                            }
                        } label: {
                            Label {
                                Text("Try with Demo Data")
                                    .font(.system(size: 14, weight: .medium))
                            } icon: {
                                Image(systemName: "sparkles")
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

                    Spacer()
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
