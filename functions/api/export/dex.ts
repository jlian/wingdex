import { computeDex } from '../../lib/dex-query'
import { exportDexToCSV } from '../../lib/ebird'

export const onRequestGet: PagesFunction<Env> = async context => {
  const userId = (context.data as { user?: { id?: string } }).user?.id
  const log = (context.data as RequestData).log
  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  const dex = await computeDex(context.env.DB, userId)
  const csv = exportDexToCSV(dex)
  log?.info('export/dex/export', { category: 'Application', resultDescription: `Exported dex CSV with ${dex.length} species (${csv.length} bytes)`, properties: { speciesCount: dex.length, csvLength: csv.length } })

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="wingdex-dex.csv"',
      'cache-control': 'no-store',
    },
  })
}
