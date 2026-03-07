/**
 * Mobile OAuth callback bridge.
 *
 * After a social OAuth flow (GitHub / Apple), Better Auth creates a session,
 * sets a session cookie, and redirects the user to the configured callbackURL.
 * For mobile clients, that callbackURL points here.
 *
 * This handler reads the session via cookie, extracts the raw session token,
 * and redirects to the app's custom URL scheme with the token + user info
 * so ASWebAuthenticationSession can capture it.
 *
 * The iOS app stores this token in Keychain and sends it as
 * Authorization: Bearer on all subsequent requests. The bearer() plugin
 * on the server validates it natively.
 *
 * Flow:
 *   1. iOS opens /api/auth/signin/github?callbackURL=/api/auth/mobile/callback
 *   2. OAuth happens... Better Auth sets cookie + redirects here
 *   3. We read the session, redirect to wingdex://auth/callback?token=...
 *   4. ASWebAuthenticationSession captures the custom scheme URL
 */
import { createAuth } from '../../../lib/auth'

const APP_SCHEME = 'wingdex'

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = createAuth(context.env, { request: context.request })
  const session = await auth.api.getSession({ headers: context.request.headers })

  if (!session?.user?.id || !session?.session?.token) {
    const errorUrl = `${APP_SCHEME}://auth/callback?error=no_session`
    return Response.redirect(errorUrl, 302)
  }

  // Use the raw session token from the DB. The bearer() plugin validates
  // raw tokens directly - no HMAC-signed cookie value needed.
  const params = new URLSearchParams({
    token: session.session.token,
    expires_at: session.session.expiresAt.toISOString(),
    user_id: session.user.id,
    user_name: session.user.name || '',
    user_email: session.user.email || '',
  })

  if (session.user.image) {
    params.set('user_image', session.user.image)
  }

  const callbackUrl = `${APP_SCHEME}://auth/callback?${params.toString()}`
  return Response.redirect(callbackUrl, 302)
}
