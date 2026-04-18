import { createAuth } from '../../lib/auth'

export const onRequestGet: PagesFunction<Env> = async context => {
  const log = (context.data as RequestData).log
  const auth = createAuth(context.env, { request: context.request })
  const session = await auth.api.getSession({ headers: context.request.headers })

  if (!session?.user?.id) {
    return new Response('Unauthorized', { status: 401 })
  }

  const result = await context.env.DB
    .prepare('SELECT providerId FROM account WHERE userId = ?')
    .bind(session.user.id)
    .all<{ providerId?: string | null }>()

  const providers = Array.from(
    new Set(
      result.results
        .map(row => row.providerId)
        .filter((providerId): providerId is string => Boolean(providerId))
    )
  )
  log?.info('auth/linkedProviders/read', { category: 'Application', resultDescription: `User has ${providers.length} linked auth providers`, properties: { providerCount: providers.length } })

  return Response.json({ providers }, {
    headers: { 'cache-control': 'no-store' },
  })
}
