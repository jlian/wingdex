/**
 * Mobile OAuth entry point.
 *
 * ASWebAuthenticationSession opens a URL in a browser - it cannot POST.
 * Better Auth's sign-in/social endpoint expects POST with JSON body and
 * returns { url, redirect: true } plus state/PKCE cookies.
 *
 * This GET handler proxies that internally: it POSTs to Better Auth,
 * captures the redirect URL and Set-Cookie headers, then returns a 302
 * so the browser follows the OAuth flow with the correct cookies.
 *
 * Flow:
 *   1. iOS opens GET /api/auth/mobile/start?provider=github
 *   2. This handler POSTs to Better Auth sign-in/social internally
 *   3. Better Auth returns { url } + sets state cookies
 *   4. We 302 redirect the browser to the OAuth provider, forwarding cookies
 *   5. OAuth flow proceeds... ends at /api/auth/mobile/callback
 */
import { createAuth } from '../../../lib/auth'

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  const provider = url.searchParams.get('provider')

  if (!provider) {
    return new Response('Missing provider parameter', { status: 400 })
  }

  const auth = createAuth(context.env, { request: context.request })

  // Build a synthetic POST to Better Auth's sign-in/social endpoint
  const signInUrl = new URL('/api/auth/sign-in/social', url.origin)
  const internalReq = new Request(signInUrl.toString(), {
    method: 'POST',
    headers: new Headers({
      'Content-Type': 'application/json',
      Cookie: context.request.headers.get('Cookie') || '',
    }),
    body: JSON.stringify({
      provider,
      callbackURL: '/api/auth/mobile/callback',
    }),
  })

  const response = await auth.handler(internalReq)

  // Better Auth returns JSON { url, redirect: true } plus Set-Cookie for state/PKCE
  let redirectUrl: string
  try {
    const json = (await response.json()) as { url?: string; redirect?: boolean }
    if (!json.url) {
      return new Response('No redirect URL from auth provider', { status: 500 })
    }
    redirectUrl = json.url
  } catch {
    return new Response('Invalid response from auth', { status: 500 })
  }

  // Build a 302 redirect, forwarding all Set-Cookie headers from Better Auth
  // so the browser has the state/PKCE cookies for the OAuth callback
  const headers = new Headers({ Location: redirectUrl })
  const setCookies = response.headers.getSetCookie?.() ?? []
  for (const cookie of setCookies) {
    headers.append('Set-Cookie', cookie)
  }

  // Fallback: if getSetCookie isn't available, iterate manually
  if (setCookies.length === 0) {
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        headers.append('Set-Cookie', value)
      }
    })
  }

  return new Response(null, { status: 302, headers })
}
