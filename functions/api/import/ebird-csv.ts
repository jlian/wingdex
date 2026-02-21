import { computeDex } from '../../lib/dex-query'
import { detectImportConflicts, parseEBirdCSV, type ImportPreview } from '../../lib/ebird'

type EncodedPreview = ImportPreview & { previewId: string }

const MAX_CSV_SIZE_BYTES = 10 * 1024 * 1024

function encodePreviewId(preview: ImportPreview): string {
  const json = JSON.stringify(preview)
  const bytes = new TextEncoder().encode(json)
  // Avoid String.fromCharCode(...bytes) which can exceed call-stack limits
  // for large payloads. Build the binary string in chunks instead.
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

export const onRequestPost: PagesFunction<Env> = async context => {
  const userId = (context.data as { user?: { id?: string } }).user?.id
  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  let formData: FormData
  try {
    formData = await context.request.formData()
  } catch {
    return new Response('Invalid form payload', { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return new Response('Missing CSV file', { status: 400 })
  }

  if (file.size > MAX_CSV_SIZE_BYTES) {
    return new Response('CSV file too large (max 10MB)', { status: 413 })
  }

  const profileTimezone = formData.get('profileTimezone')
  const csvContent = await file.text()
  const previews = parseEBirdCSV(csvContent, typeof profileTimezone === 'string' ? profileTimezone : undefined)

  const existingDexRows = await computeDex(context.env.DB, userId)
  const existingDex = new Map(existingDexRows.map(row => [row.speciesName, row]))
  const withConflicts = detectImportConflicts(previews, existingDex)

  const previewsWithIds: EncodedPreview[] = withConflicts.map(preview => ({
    ...preview,
    previewId: encodePreviewId(preview),
  }))

  const summary = {
    total: previewsWithIds.length,
    new: previewsWithIds.filter(preview => preview.conflict === 'new').length,
    duplicates: previewsWithIds.filter(preview => preview.conflict === 'duplicate').length,
    updates: previewsWithIds.filter(preview => preview.conflict === 'update_dates').length,
  }

  return Response.json({ previews: previewsWithIds, summary })
}
