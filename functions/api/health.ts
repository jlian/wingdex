import { createRouteResponder } from '../lib/log'

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const route = createRouteResponder((context.data as RequestData).log, 'health/database/read', 'Application')
  try {
    const result = await context.env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>()
    if (result?.ok === 1) {
      return Response.json({ status: 'ok', db: 'ok' })
    }
    route.log?.warn('health/database/read', { category: 'Application', resultType: 'Failed', resultSignature: 503, resultDescription: 'D1 health check returned an unexpected result; the database may be in a degraded state' })
    return Response.json({ status: 'degraded', db: 'unexpected' }, { status: 503 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    route.log?.error('health/database/read', { category: 'Application', resultType: 'Failed', resultSignature: 503, resultDescription: `D1 health check failed: ${message}` })
    return Response.json({ status: 'degraded', db: 'error' }, { status: 503 })
  }
}
