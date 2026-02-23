import { searchSpecies } from '../../lib/taxonomy'

function parseLimit(value: string | null): number {
  if (!value) return 8
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) return 8
  return Math.max(1, Math.min(parsed, 25))
}

export const onRequestGet: PagesFunction<Env> = async context => {
  const userId = (context.data as { user?: { id?: string } }).user?.id
  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  const query = new URL(context.request.url).searchParams.get('q') ?? ''
  const limit = parseLimit(new URL(context.request.url).searchParams.get('limit'))

  if (!query.trim()) {
    return Response.json({ results: [] })
  }

  const results = searchSpecies(query, limit)
  return Response.json({ results })
}
