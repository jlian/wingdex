import { getEbirdCode } from '../../lib/taxonomy'

export const onRequestGet: PagesFunction<Env> = async context => {
  const userId = (context.data as { user?: { id?: string } }).user?.id
  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  const name = new URL(context.request.url).searchParams.get('name') ?? ''
  const trimmed = name.trim()

  if (!trimmed) {
    return Response.json({ ebirdCode: null })
  }

  const ebirdCode = getEbirdCode(trimmed)
  return Response.json({ ebirdCode: ebirdCode || null })
}
