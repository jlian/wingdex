import AuthenticationServices
import SwiftUI

/// Full-screen sign-in view shown when the user is not authenticated.
///
/// Matches the web app's auth gate styling: forest green branding,
/// social providers first, passkey button in primary green.
struct SignInView: View {
    @Environment(AuthService.self) private var auth
    @State private var isSigningIn = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // App branding
            VStack(spacing: 12) {
                Image(systemName: "bird.fill")
                    .font(.system(size: 72))
                    .foregroundStyle(Color.accentColor)
                    .symbolEffect(.breathe, options: .repeating)

                Text("WingDex")
                    .font(.system(size: 34, weight: .bold, design: .serif))

                Text("Track your bird sightings")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            // Sign-in buttons - matching web order: passkey (primary), social (outline)
            VStack(spacing: 12) {
                // Passkey - primary CTA (green filled)
                Button {
                    signIn { try await auth.signInWithPasskey() }
                } label: {
                    Label("Sign in with Passkey", systemImage: "person.badge.key.fill")
                        .font(.body.weight(.medium))
                        .frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color.accentColor)

                // GitHub - outlined
                Button {
                    signIn { try await auth.signInWithGitHub() }
                } label: {
                    Label {
                        Text("Sign in with GitHub")
                            .font(.body.weight(.medium))
                    } icon: {
                        Image(systemName: "chevron.left.forwardslash.chevron.right")
                    }
                    .frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.bordered)
                .tint(.primary)

                // Apple - native button
                SignInWithAppleButton(.signIn) { request in
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
                .frame(height: 48)

                #if DEBUG
                // Anonymous sign-in for local dev (no OAuth credentials needed)
                Divider()
                    .padding(.vertical, 4)

                Button {
                    signIn { try await auth.signInAnonymously() }
                } label: {
                    Label("Try Without Account", systemImage: "person.crop.circle.badge.questionmark")
                        .font(.body.weight(.medium))
                        .frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.bordered)
                .tint(.secondary)
                #endif
            }
            .padding(.horizontal, 32)
            .disabled(isSigningIn)

            if isSigningIn {
                ProgressView()
                    .padding(.top, 16)
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                    .padding(.top, 12)
            }

            // Footer
            VStack(spacing: 4) {
                Text("By signing in you agree to the")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                HStack(spacing: 4) {
                    Link("Terms of Use", destination: URL(string: "https://wingdex.pages.dev/terms.html")!)
                    Text("and")
                    Link("Privacy Policy", destination: URL(string: "https://wingdex.pages.dev/privacy.html")!)
                }
                .font(.caption2)
                .foregroundStyle(Color.accentColor)
            }
            .padding(.top, 24)
            .padding(.bottom, 40)
        }
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
