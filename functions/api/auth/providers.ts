export const onRequestGet: PagesFunction<Env> = async (context) => {
  const providers: string[] = []
  if (context.env.GITHUB_CLIENT_ID && context.env.GITHUB_CLIENT_SECRET) {
    providers.push('github')
  }
  if (context.env.APPLE_CLIENT_ID && context.env.APPLE_CLIENT_SECRET) {
    providers.push('apple')
  }
  if (context.env.GOOGLE_CLIENT_ID && context.env.GOOGLE_CLIENT_SECRET) {
    providers.push('google')
  }
  return Response.json({ providers }, {
    headers: { 'cache-control': 'public, max-age=300' },
  })
}
