import { computeDex } from '../../../lib/dex-query'
import { groupPreviewsIntoOutings, type ImportPreview } from '../../../lib/ebird'

type ConfirmBody = { previewIds: string[] }

function isConfirmBody(value: unknown): value is ConfirmBody {
  if (!value || typeof value !== 'object') return false
  const data = value as Record<string, unknown>
  return Array.isArray(data.previewIds) && data.previewIds.every(id => typeof id === 'string')
}

function decodePreviewId(previewId: string): ImportPreview | null {
  try {
    const json = decodeURIComponent(escape(atob(previewId)))
    const parsed = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as ImportPreview
  } catch {
    return null
  }
}

export const onRequestPost: PagesFunction<Env> = async context => {
  const userId = (context.data as { user?: { id?: string } }).user?.id
  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  let body: unknown
  try {
    body = await context.request.json()
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  if (!isConfirmBody(body)) {
    return new Response('Invalid confirm payload', { status: 400 })
  }

  const selectedPreviews = body.previewIds
    .map(previewId => decodePreviewId(previewId))
    .filter((preview): preview is ImportPreview => !!preview)

  if (selectedPreviews.length === 0) {
    const dexUpdates = await computeDex(context.env.DB, userId)
    return Response.json({ imported: { outings: 0, observations: 0, newSpecies: 0 }, dexUpdates })
  }

  const { outings, observations } = groupPreviewsIntoOutings(selectedPreviews, userId)

  const insertStatements: D1PreparedStatement[] = []

  for (const outing of outings) {
    insertStatements.push(
      context.env.DB
        .prepare(
          `INSERT INTO outing (id, userId, startTime, endTime, locationName, defaultLocationName, lat, lon, notes, createdAt)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
        )
        .bind(
          outing.id,
          userId,
          outing.startTime,
          outing.endTime,
          outing.locationName,
          outing.defaultLocationName ?? null,
          outing.lat ?? null,
          outing.lon ?? null,
          outing.notes,
          outing.createdAt
        )
    )
  }

  for (const observation of observations) {
    insertStatements.push(
      context.env.DB
        .prepare(
          `INSERT INTO observation (id, outingId, userId, speciesName, count, certainty, notes)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
        )
        .bind(
          observation.id,
          observation.outingId,
          userId,
          observation.speciesName,
          observation.count,
          observation.certainty,
          observation.notes
        )
    )
  }

  if (insertStatements.length > 0) {
    await context.env.DB.batch(insertStatements)
  }

  const dexUpdates = await computeDex(context.env.DB, userId)
  const importedSpecies = new Set(observations.map(observation => observation.speciesName))

  return Response.json({
    imported: {
      outings: outings.length,
      observations: observations.length,
      newSpecies: importedSpecies.size,
    },
    dexUpdates: dexUpdates.map(row => ({
      ...row,
      addedDate: row.addedDate || undefined,
      bestPhotoId: row.bestPhotoId || undefined,
    })),
  })
 }
