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
                    signIn { try await auth.signInWithGitHub() }
                } label: {
                    Label("Sign in with GitHub", systemImage: "chevron.left.forwardslash.chevron.right")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)

                SignInWithAppleButton(.signIn) { _ in
                    // ASAuthorizationAppleIDRequest configuration (scopes handled by server)
                } onCompletion: { _ in
                    // Native Apple Sign-In deferred - using web OAuth for now
                    signIn { try await auth.signInWithApple() }
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
