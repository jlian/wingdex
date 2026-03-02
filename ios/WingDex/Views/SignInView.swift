import AuthenticationServices
import SwiftUI

/// Full-screen sign-in view matching the web app's auth gate.
///
/// Warm beige background, centered bird icon, cream card with
/// social providers + passkey button in the web's exact order.
struct SignInView: View {
    @Environment(AuthService.self) private var auth
    @State private var isSigningIn = false
    @State private var errorMessage: String?

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(spacing: 0) {
                    Spacer(minLength: 24)

                    // Bird icon in a subtle circle (matching web's hero bird)
                    Image(systemName: "bird.fill")
                        .font(.system(size: 40))
                        .foregroundStyle(Color.accentColor)
                        .frame(width: 80, height: 80)
                        .background(.ultraThinMaterial)
                        .clipShape(Circle())
                        .padding(.bottom, 16)

                    // Auth card
                    VStack(spacing: 12) {
                        // Header
                        VStack(spacing: 8) {
                            Text("Sign up")
                                .font(.system(size: 20, weight: .semibold))

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
                            .font(.subheadline)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                        }

                        // Social buttons
                        VStack(spacing: 8) {
                            // GitHub - outlined
                            Button {
                                signIn { try await auth.signInWithGitHub() }
                            } label: {
                                Label {
                                    Text("Continue with GitHub")
                                        .font(.subheadline.weight(.medium))
                                } icon: {
                                    Image(systemName: "chevron.left.forwardslash.chevron.right")
                                        .font(.body)
                                }
                                .frame(maxWidth: .infinity, minHeight: 40)
                            }
                            .buttonStyle(.bordered)
                            .tint(.primary)

                            // Apple - native outlined button
                            SignInWithAppleButton(.continue) { request in
                                request.requestedScopes = [.fullName, .email]
                            } onCompletion: { result in
                                switch result {
                                case .success(let authorization):
                                    guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
                                        errorMessage = "Unexpected credential type"
                                        return
                                    }
                                    signIn { try await auth.signInWithApple(credential: credential) }
                                case .failure(let error):
                                    if (error as? ASAuthorizationError)?.code != .canceled {
                                        errorMessage = error.localizedDescription
                                    }
                                }
                            }
                            .signInWithAppleButtonStyle(.whiteOutline)
                            .frame(height: 40)
                        }

                        // OR divider
                        HStack {
                            VStack { Divider() }
                            Text("OR")
                                .font(.caption2.weight(.medium))
                                .foregroundStyle(Color.mutedText)
                            VStack { Divider() }
                        }

                        // Passkey - primary filled green
                        Button {
                            signIn { try await auth.signInWithPasskey() }
                        } label: {
                            Label("Sign up with a Passkey", systemImage: "person.badge.key.fill")
                                .font(.subheadline.weight(.medium))
                                .frame(maxWidth: .infinity, minHeight: 40)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Color.accentColor)

                        // Error message
                        if let errorMessage {
                            Text(errorMessage)
                                .font(.caption)
                                .foregroundStyle(.red)
                                .multilineTextAlignment(.center)
                        }

                        #if DEBUG
                        // Anonymous sign-in for local dev
                        Button {
                            signIn { try await auth.signInAnonymously() }
                        } label: {
                            Label("Try Without Account", systemImage: "person.crop.circle.badge.questionmark")
                                .font(.subheadline.weight(.medium))
                                .frame(maxWidth: .infinity, minHeight: 40)
                        }
                        .buttonStyle(.bordered)
                        .tint(Color.mutedText)
                        #endif
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 20)
                    .background(Color.cardBg)
                    .clipShape(RoundedRectangle(cornerRadius: 18))
                    .overlay(
                        RoundedRectangle(cornerRadius: 18)
                            .stroke(Color.warmBorder, lineWidth: 1)
                    )
                    .padding(.horizontal, 16)
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
