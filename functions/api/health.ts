export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const result = await context.env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>()
    if (result?.ok === 1) {
      return Response.json({ status: 'ok', db: 'ok' })
    }
    return Response.json({ status: 'degraded', db: 'unexpected' }, { status: 503 })
  } catch {
    return Response.json({ status: 'degraded', db: 'error' }, { status: 503 })
  }
}
