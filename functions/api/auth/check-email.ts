export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  const email = url.searchParams.get('email')?.trim().toLowerCase()

  if (!email) {
    return Response.json({ exists: false })
  }

  const row = await context.env.DB
    .prepare('SELECT 1 FROM "user" WHERE email = ? LIMIT 1')
    .bind(email)
    .first()

  return Response.json({ exists: Boolean(row) })
}
