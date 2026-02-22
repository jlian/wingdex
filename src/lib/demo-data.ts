import demoCsv from '../../e2e/fixtures/ebird-import.csv?raw'
import { fetchWithLocalAuthRetry } from '@/lib/local-auth-fetch'
import type { WingDexDataStore } from '@/hooks/use-wingdex-data'

export async function loadDemoData(data: WingDexDataStore): Promise<void> {
  data.clearAllData()

  const formData = new FormData()
  formData.append('file', new Blob([demoCsv], { type: 'text/csv' }), 'demo.csv')

  const previewRes = await fetchWithLocalAuthRetry('/api/import/ebird-csv', {
    method: 'POST',
    credentials: 'include',
    body: formData,
  })
  if (!previewRes.ok) throw new Error(`Preview failed (${previewRes.status})`)

  const { previews } = await previewRes.json() as { previews: Array<{ previewId: string }> }

  const confirmRes = await fetchWithLocalAuthRetry('/api/import/ebird-csv/confirm', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ previewIds: previews.map((p) => p.previewId) }),
  })
  if (!confirmRes.ok) throw new Error(`Confirm failed (${confirmRes.status})`)

  await data.refresh()
}
