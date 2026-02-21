import { createAuth } from './lib/auth'

export const onRequest: PagesFunction<Env> = async (context) => {
  const { pathname } = new URL(context.request.url)

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
