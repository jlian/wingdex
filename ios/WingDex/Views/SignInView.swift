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
        GeometryReader { geometry in
            ScrollView {
                VStack(spacing: 0) {
                    Spacer(minLength: 24)

                    // Bird icon - web uses 28px Phosphor bird in primary green
                    Image(systemName: "bird.fill")
                        .font(.system(size: 28))
                        .foregroundStyle(Color.accentColor)
                        .padding(.bottom, 24)

                    // Auth controls - vertically stacked with consistent 36pt button height
                    VStack(spacing: 16) {
                        // Header - web: serif 18px semibold + 14px muted terms
                        VStack(spacing: 8) {
                            Text("Sign up")
                                .font(.system(size: 18, weight: .semibold, design: .serif))
                                .foregroundStyle(Color.foregroundText)

                            (Text("By continuing you accept our ")
                                .foregroundStyle(Color.mutedText)
                            + Text("Terms of Use")
                                .foregroundStyle(Color.accentColor)
                            + Text(" and ")
                                .foregroundStyle(Color.mutedText)
                            + Text("Privacy Policy")
                                .foregroundStyle(Color.accentColor)
                            + Text(".")
                                .foregroundStyle(Color.mutedText))
                            .font(.system(size: 14))
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

                            // Apple - native Sign In button, outlined
                            SignInWithAppleButton(.continue) { request in
                                request.requestedScopes = [.fullName, .email]
                            } onCompletion: { result in
                                switch result {
                                case .success(let authorization):
                                    guard let credential = authorization.credential
                                        as? ASAuthorizationAppleIDCredential else {
                                        errorMessage = "Unexpected credential type"
                                        return
                                    }
                                    signIn {
                                        try await auth.signInWithApple(credential: credential)
                                    }
                                case .failure(let error):
                                    if (error as? ASAuthorizationError)?.code != .canceled {
                                        errorMessage = error.localizedDescription
                                    }
                                }
                            }
                            .signInWithAppleButtonStyle(.whiteOutline)
                            .frame(height: 36)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
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
                                Text("Sign up with a Passkey")
                                    .font(.system(size: 14, weight: .medium))
                            } icon: {
                                Image(systemName: "person.badge.key.fill")
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
                        }

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
            } catch {
                errorMessage = error.localizedDescription
            }
            isSigningIn = false
        }
    }
}

#Preview {
    SignInView()
        .environment(AuthService())
}
