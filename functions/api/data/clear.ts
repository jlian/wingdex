export const onRequestDelete: PagesFunction<Env> = async context => {
  const userId = (context.data as { user?: { id?: string } }).user?.id
  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  await context.env.DB.batch([
    context.env.DB.prepare('DELETE FROM outing WHERE userId = ?').bind(userId),
    context.env.DB.prepare('DELETE FROM dex_meta WHERE userId = ?').bind(userId),
  ])

  return Response.json({ cleared: true })
}
