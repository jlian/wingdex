import { exportOutingToEBirdCSV } from '../../../lib/ebird'

async function hasOutingRegionColumns(db: D1Database): Promise<boolean> {
  const info = await db.prepare("PRAGMA table_info('outing')").all<{ name: string }>()
  const names = new Set(info.results.map(column => column.name))
  return names.has('stateProvince') && names.has('countryCode')
}

export const onRequestGet: PagesFunction<Env> = async context => {
  const userId = (context.data as { user?: { id?: string } }).user?.id
  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  const outingId = context.params.id as string | undefined
  if (!outingId) {
    return new Response('Missing outing id', { status: 400 })
  }

  const supportsRegionColumns = await hasOutingRegionColumns(context.env.DB)
  const outingQuery = supportsRegionColumns
    ? 'SELECT id, startTime, endTime, locationName, lat, lon, stateProvince, countryCode, notes FROM outing WHERE id = ? AND userId = ? LIMIT 1'
    : 'SELECT id, startTime, endTime, locationName, lat, lon, NULL as stateProvince, NULL as countryCode, notes FROM outing WHERE id = ? AND userId = ? LIMIT 1'

  const outingResult = await context.env.DB
    .prepare(outingQuery)
    .bind(outingId, userId)
    .all<{
      id: string
      startTime: string
      endTime: string
      locationName: string
      lat?: number | null
      lon?: number | null
      stateProvince?: string | null
      countryCode?: string | null
      notes?: string | null
    }>()

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
