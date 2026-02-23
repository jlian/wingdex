export const onRequestGet: PagesFunction<Env> = async (context) => {
  const turnstileSiteKey = context.env.TURNSTILE_SITE_KEY?.trim() || ''

  return Response.json({ turnstileSiteKey }, {
    headers: { 'cache-control': 'public, max-age=300' },
  })
}