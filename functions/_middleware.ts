import { createAuth } from './lib/auth'

export const onRequest: PagesFunction<Env> = async (context) => {
  const { pathname, hostname } = new URL(context.request.url)
  const isLocalRuntime = hostname === 'localhost' || hostname === '127.0.0.1'

  if (pathname === '/api/auth/sign-in/anonymous' && !isLocalRuntime) {
    const signupHeader = context.request.headers.get('x-wingdex-passkey-signup')
    if (signupHeader !== '1') {
      return new Response('Forbidden', { status: 403 })
    }
  }

  if (!pathname.startsWith('/api/') || pathname.startsWith('/api/auth')) {
    return context.next()
  }

  const auth = createAuth(context.env, { request: context.request })
  const session = await auth.api.getSession({
    headers: context.request.headers,
  })

  if (!session) {
    return new Response('Unauthorized', { status: 401 })
  }

  context.data.user = session.user
  context.data.session = session.session

  return context.next()
}
