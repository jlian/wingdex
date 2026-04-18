import { computeDex } from '../../lib/dex-query'
import { detectImportConflicts, parseEBirdCSV, type ImportPreview } from '../../lib/ebird'

type EncodedPreview = ImportPreview & { previewId: string }

const MAX_CSV_SIZE_BYTES = 10 * 1024 * 1024

function encodePreviewId(preview: ImportPreview): string {
  const json = JSON.stringify(preview)
  const bytes = new TextEncoder().encode(json)
  // Build the binary string via an array to avoid O(n²) string concatenation.
  const chars = new Array<string>(bytes.length)
  for (let i = 0; i < bytes.length; i++) {
    chars[i] = String.fromCharCode(bytes[i])
  }
  return btoa(chars.join(''))
}

export const onRequestPost: PagesFunction<Env> = async context => {
  const userId = (context.data as { user?: { id?: string } }).user?.id
  const log = (context.data as RequestData).log
  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  let formData: FormData
  try {
    formData = await context.request.formData()
  } catch {
    log?.warn('import/ebirdCsv/import', { category: 'Application', resultType: 'Failed', resultSignature: 400, resultDescription: 'Could not parse request body as multipart/form-data; ensure the request uses multipart encoding with a file field' })
    return new Response('Invalid form payload', { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    log?.warn('import/ebirdCsv/import', { category: 'Application', resultType: 'Failed', resultSignature: 400, resultDescription: 'No CSV file found in the file form field; include a file field with the eBird CSV export' })
    return new Response('Missing CSV file', { status: 400 })
  }

  if (file.size > MAX_CSV_SIZE_BYTES) {
    log?.warn('import/ebirdCsv/import', { category: 'Application', resultType: 'Failed', resultSignature: 413, resultDescription: `CSV file is ${file.size} bytes, exceeding the ${MAX_CSV_SIZE_BYTES}-byte limit; try exporting a smaller date range from eBird`, properties: { fileSize: file.size, limit: MAX_CSV_SIZE_BYTES } })
    return new Response('CSV file too large (max 10MB)', { status: 413 })
  }

  const profileTimezone = formData.get('profileTimezone')
  const csvContent = await file.text()
  const previews = parseEBirdCSV(csvContent, typeof profileTimezone === 'string' ? profileTimezone : undefined)
  log?.debug('import/ebirdCsv/import', { category: 'Application', resultDescription: `Parsed ${previews.length} sighting rows from ${file.size}-byte CSV`, properties: { fileSize: file.size, rowCount: previews.length } })

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
