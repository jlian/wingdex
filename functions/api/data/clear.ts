export const onRequestDelete: PagesFunction<Env> = async context => {
  const userId = (context.data as { user?: { id?: string } }).user?.id
  const log = (context.data as RequestData).log
  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  await context.env.DB.batch([
    context.env.DB.prepare('DELETE FROM outing WHERE userId = ?').bind(userId),
    context.env.DB.prepare('DELETE FROM dex_meta WHERE userId = ?').bind(userId),
  ])
  log?.info('clear.deleteAll', { category: 'Data', resultType: 'Succeeded', resultDescription: 'Deleted all outings and dex metadata for user' })

  return Response.json({ cleared: true })
}
