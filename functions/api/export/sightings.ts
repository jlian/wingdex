import { exportOutingToEBirdCSV } from '../../lib/ebird'

type ExportRow = {
  outingId: string
  startTime: string
  endTime: string
  locationName: string
  lat?: number | null
  lon?: number | null
  stateProvince?: string | null
  countryCode?: string | null
  outingNotes?: string | null
  speciesName: string
  count: number
  certainty: 'confirmed' | 'possible' | 'pending' | 'rejected'
  observationNotes?: string | null
}

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

  const supportsRegionColumns = await hasOutingRegionColumns(context.env.DB)
  const rowsQuery = supportsRegionColumns
    ? `SELECT
         o.id as outingId,
         o.startTime,
         o.endTime,
         o.locationName,
         o.lat,
         o.lon,
         o.stateProvince,
         o.countryCode,
         o.notes as outingNotes,
         ob.speciesName,
         ob.count,
         ob.certainty,
         ob.notes as observationNotes
       FROM observation ob
       INNER JOIN outing o ON o.id = ob.outingId
       WHERE ob.userId = ?
       ORDER BY o.startTime ASC, o.id ASC, ob.id ASC`
    : `SELECT
         o.id as outingId,
         o.startTime,
         o.endTime,
         o.locationName,
         o.lat,
         o.lon,
         NULL as stateProvince,
         NULL as countryCode,
         o.notes as outingNotes,
         ob.speciesName,
         ob.count,
         ob.certainty,
         ob.notes as observationNotes
       FROM observation ob
       INNER JOIN outing o ON o.id = ob.outingId
       WHERE ob.userId = ?
       ORDER BY o.startTime ASC, o.id ASC, ob.id ASC`

  const rowsResult = await context.env.DB
    .prepare(rowsQuery)
    .bind(userId)
    .all<ExportRow>()

  const rows = rowsResult.results
  if (rows.length === 0) {
    const emptyCsv = exportOutingToEBirdCSV(
      {
        id: 'empty',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        locationName: '',
      },
      [],
      true
    )

    return new Response(emptyCsv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="wingdex-sightings.csv"',
        'cache-control': 'no-store',
      },
    })
  }

  const byOuting = new Map<string, ExportRow[]>()
  for (const row of rows) {
    const existing = byOuting.get(row.outingId)
    if (existing) existing.push(row)
    else byOuting.set(row.outingId, [row])
  }

  const csvChunks: string[] = []
  let includeHeader = true

  for (const outingRows of byOuting.values()) {
    const first = outingRows[0]
    const csv = exportOutingToEBirdCSV(
      {
        id: first.outingId,
        startTime: first.startTime,
        endTime: first.endTime,
        locationName: first.locationName,
        lat: first.lat,
        lon: first.lon,
        stateProvince: first.stateProvince,
        countryCode: first.countryCode,
        notes: first.outingNotes,
      },
      outingRows.map(row => ({
        speciesName: row.speciesName,
        count: row.count,
        certainty: row.certainty,
        notes: row.observationNotes,
      })),
      includeHeader
    )

    includeHeader = false
    if (csv.trim()) {
      csvChunks.push(csv)
    }
  }

  const csv = csvChunks.join('\n')

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="wingdex-sightings-${new Date().toISOString().split('T')[0]}.csv"`,
      'cache-control': 'no-store',
    },
  })
}
