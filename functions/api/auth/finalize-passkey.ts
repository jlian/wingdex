import { createAuth } from '../../lib/auth'

type FinalizeBody = {
  name?: string
}

export const onRequestPost: PagesFunction<Env> = async context => {
  const auth = createAuth(context.env, { request: context.request })
  const session = await auth.api.getSession({ headers: context.request.headers })

  if (!session?.user?.id) {
    return new Response('Unauthorized', { status: 401 })
  }

  let body: FinalizeBody = {}
  try {
    body = await context.request.json() as FinalizeBody
  } catch {
    body = {}
  }

  const requestedName = typeof body.name === 'string' ? body.name.trim() : ''
  const nextName = requestedName.length > 0 ? requestedName : (session.user.name || 'Bird Enthusiast')

  await context.env.DB
    .prepare('UPDATE "user" SET isAnonymous = 0, name = ?, updatedAt = datetime(\'now\') WHERE id = ?')
    .bind(nextName, session.user.id)
    .run()

  return Response.json({ success: true })
}
