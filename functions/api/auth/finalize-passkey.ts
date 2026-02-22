import { createAuth } from '../../lib/auth'

type FinalizeBody = {
  name?: string
  email?: string
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

  const requestedEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''

  if (requestedEmail) {
    // Check uniqueness
    const existing = await context.env.DB
      .prepare('SELECT 1 FROM "user" WHERE email = ? AND id != ? LIMIT 1')
      .bind(requestedEmail, session.user.id)
      .first()
    if (existing) {
      return Response.json({ error: 'email_taken' }, { status: 409 })
    }

    await context.env.DB
      .prepare('UPDATE "user" SET isAnonymous = 0, name = ?, email = ?, updatedAt = datetime(\'now\') WHERE id = ?')
      .bind(nextName, requestedEmail, session.user.id)
      .run()
  } else {
    await context.env.DB
      .prepare('UPDATE "user" SET isAnonymous = 0, name = ?, updatedAt = datetime(\'now\') WHERE id = ?')
      .bind(nextName, session.user.id)
      .run()
  }

  return Response.json({ success: true })
}
