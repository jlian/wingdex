import { createAuth } from '../../lib/auth'
import { waitForPasskeyOwnership } from '../../lib/passkey-ownership'
import { createRouteResponder } from '../../lib/log'

export const onRequestPost: PagesFunction<Env> = async context => {
  const log = (context.data as RequestData).log
  const route = createRouteResponder(log, 'auth/finalizePasskey/invoke', 'Audit')
  const auth = createAuth(context.env, { request: context.request })
  const session = await auth.api.getSession({ headers: context.request.headers })

  if (!session?.user?.id) {
    return new Response('Unauthorized', { status: 401 })
  }

  let body: { name?: string; passkeyId?: string }
  try {
    body = await context.request.json() as { name?: string; passkeyId?: string }
  } catch {
    return route.fail(400, 'Invalid JSON body', 'Request body could not be parsed as JSON; check Content-Type is application/json and body is valid JSON')
  }

  const passkeyId = typeof body.passkeyId === 'string' ? body.passkeyId.trim() : ''
  const ownsPasskey = await waitForPasskeyOwnership(
    context.env.DB,
    session.user.id,
    passkeyId || undefined,
  )
  if (!ownsPasskey) {
    return route.fail(403, 'Passkey required', `User does not own passkey ${passkeyId || '(none)'} or no passkey found for this user`, { passkeyId: passkeyId || undefined })
  }

  try {
    const requestedName = typeof body.name === 'string' ? body.name.trim() : ''
    const nextName = requestedName.length > 0 ? requestedName : (session.user.name || 'Bird Enthusiast')

    await context.env.DB
      .prepare('UPDATE "user" SET isAnonymous = 0, name = ?, updatedAt = datetime(\'now\') WHERE id = ?')
      .bind(nextName, session.user.id)
      .run()
    route.info('User finalized passkey upgrade and is no longer anonymous')

    return Response.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return route.fail(500, 'Internal server error', `Passkey finalization failed: ${message}`, { error: message, userId: session.user.id })
  }
}
