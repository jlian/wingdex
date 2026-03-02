import AuthenticationServices
import SwiftUI

/// Full-screen sign-in view shown when the user is not authenticated.
struct SignInView: View {
    @Environment(AuthService.self) private var auth
    @State private var isSigningIn = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            // App branding
            Image(systemName: "bird.fill")
                .font(.system(size: 80))
                .foregroundStyle(.tint)

            Text("WingDex")
                .font(.largeTitle.bold())

            Text("Track your bird sightings")
                .font(.title3)
                .foregroundStyle(.secondary)

            Spacer()

            // Sign-in buttons
            VStack(spacing: 12) {
                Button {
                    signIn { try await auth.signInWithPasskey() }
                } label: {
                    Label("Sign in with Passkey", systemImage: "person.badge.key.fill")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)

                Button {
                    signIn { try await auth.signInWithGitHub() }
                } label: {
                    Label("Sign in with GitHub", systemImage: "chevron.left.forwardslash.chevron.right")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.bordered)

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
                        // Don't show error if user cancelled
                        if (error as? ASAuthorizationError)?.code != .canceled {
                            errorMessage = error.localizedDescription
                        }
                    }
                }
                .signInWithAppleButtonStyle(.whiteOutline)
                .frame(height: 44)
            }
            .padding(.horizontal, 32)
            .disabled(isSigningIn)

            if isSigningIn {
                ProgressView()
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }

            Spacer()
                .frame(height: 40)
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
