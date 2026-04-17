import { createAuth } from '../../lib/auth'
import { waitForPasskeyOwnership } from '../../lib/passkey-ownership'

export const onRequestPost: PagesFunction<Env> = async context => {
  const log = (context.data as RequestData).log
  const auth = createAuth(context.env, { request: context.request })
  const session = await auth.api.getSession({ headers: context.request.headers })

  if (!session?.user?.id) {
    return new Response('Unauthorized', { status: 401 })
  }

  let body: { name?: string; passkeyId?: string }
  try {
    body = await context.request.json() as { name?: string; passkeyId?: string }
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  const passkeyId = typeof body.passkeyId === 'string' ? body.passkeyId.trim() : ''
  const ownsPasskey = await waitForPasskeyOwnership(
    context.env.DB,
    session.user.id,
    passkeyId || undefined,
  )
  if (!ownsPasskey) {
    return new Response('Passkey required', { status: 403 })
  }

  const requestedName = typeof body.name === 'string' ? body.name.trim() : ''
  const nextName = requestedName.length > 0 ? requestedName : (session.user.name || 'Bird Enthusiast')

  await context.env.DB
    .prepare('UPDATE "user" SET isAnonymous = 0, name = ?, updatedAt = datetime(\'now\') WHERE id = ?')
    .bind(nextName, session.user.id)
    .run()
  log?.info('auth.finalizePasskey', { category: 'Auth', resultType: 'Succeeded', resultDescription: 'User finalized passkey upgrade and is no longer anonymous' })

  return Response.json({ success: true })
}
