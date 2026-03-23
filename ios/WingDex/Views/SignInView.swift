import AuthenticationServices
import SwiftUI

/// Full-screen sign-in view.
struct SignInView: View {
    @Environment(AuthService.self) private var auth
    @Environment(DataStore.self) private var store

    @Environment(\.colorScheme) private var colorScheme

    @State private var isSigningIn = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // Logo and title
            VStack(spacing: 12) {
                Image("BirdLogo")
                    .renderingMode(.template)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 36, height: 36)
                    .foregroundStyle(Color.accentColor)

                Text("Start your WingDex")
                    .font(.system(.title, design: .serif, weight: .semibold))
                    .foregroundStyle(Color.foregroundText)
            }
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
            .padding(.horizontal, 24)

            // OR divider
            HStack(spacing: 8) {
                Rectangle().fill(Color.warmBorder).frame(height: 1)
                Text("OR")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Color.mutedText)
                Rectangle().fill(Color.warmBorder).frame(height: 1)
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 16)

            // Passkey section
            VStack(spacing: 12) {
                Label("Continue with a Passkey", systemImage: "person.badge.key.fill")
                    .font(.system(size: fontSize, weight: .medium))
                    .foregroundStyle(Color.foregroundText)

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
            )
            .padding(.horizontal, 24)

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
                .foregroundStyle(Color.mutedText)
                .tint(Color.accentColor)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
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
            .tint(Color.accentColor)
            .padding(.bottom, 16)
            #endif
        }
        .background(Color.pageBg.ignoresSafeArea())
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

#if DEBUG
#Preview {
    SignInView()
        .environment(AuthService())
        .environment(previewStore(empty: true))
}
#endif
