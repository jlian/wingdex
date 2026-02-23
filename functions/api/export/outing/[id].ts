import { exportOutingToEBirdCSV } from '../../../lib/ebird'

export const onRequestGet: PagesFunction<Env> = async context => {
  const userId = (context.data as { user?: { id?: string } }).user?.id
  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  const outingId = context.params.id as string | undefined
  if (!outingId) {
    return new Response('Missing outing id', { status: 400 })
  }

  const outingResult = await context.env.DB
    .prepare('SELECT id, startTime, locationName, lat, lon, notes FROM outing WHERE id = ? AND userId = ? LIMIT 1')
    .bind(outingId, userId)
    .all<{ id: string; startTime: string; locationName: string; lat?: number | null; lon?: number | null; notes?: string | null }>()

  const outing = outingResult.results[0]
  if (!outing) {
    return new Response('Not found', { status: 404 })
  }

  const observationsResult = await context.env.DB
    .prepare(
      `SELECT speciesName, count, certainty, notes
       FROM observation
       WHERE outingId = ? AND userId = ?`
    )
    .bind(outingId, userId)
    .all<{
      speciesName: string
      count: number
      certainty: 'confirmed' | 'possible' | 'pending' | 'rejected'
      notes?: string | null
    }>()

  const csv = exportOutingToEBirdCSV(outing, observationsResult.results, true)
  const safeOutingId = outingId.replace(/[^a-zA-Z0-9._-]/g, '_')

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="wingdex-outing-${safeOutingId}.csv"`,
      'cache-control': 'no-store',
    },
  })
}
