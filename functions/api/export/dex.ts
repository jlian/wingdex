import { computeDex } from '../../lib/dex-query'
import { exportDexToCSV } from '../../lib/ebird'

export const onRequestGet: PagesFunction<Env> = async context => {
  const userId = (context.data as { user?: { id?: string } }).user?.id
  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  const dex = await computeDex(context.env.DB, userId)
  const csv = exportDexToCSV(dex)

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="wingdex-dex.csv"',
      'cache-control': 'no-store',
    },
  })
}
