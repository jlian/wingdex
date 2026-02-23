export const onRequestGet: PagesFunction<Env> = async (context) => {
  return Response.json({}, {
    headers: { 'cache-control': 'public, max-age=300' },
  })
}