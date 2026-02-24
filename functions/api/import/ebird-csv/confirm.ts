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
    const binary = atob(previewId)
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
    const json = new TextDecoder().decode(bytes)
    const parsed = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as ImportPreview
  } catch {
    return null
  }
}

async function hasOutingRegionColumns(db: D1Database): Promise<boolean> {
  const info = await db.prepare("PRAGMA table_info('outing')").all<{ name: string }>()
  const names = new Set(info.results.map(column => column.name))
  return (
    names.has('stateProvince') &&
    names.has('countryCode') &&
    names.has('protocol') &&
    names.has('numberObservers') &&
    names.has('allObsReported') &&
    names.has('effortDistanceMiles') &&
    names.has('effortAreaAcres')
  )
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

  // Snapshot species already in the user's dex before inserting
  const priorDex = await computeDex(context.env.DB, userId)
  const priorSpecies = new Set(priorDex.map(row => row.speciesName))

  const { outings, observations } = groupPreviewsIntoOutings(selectedPreviews, userId)
  const supportsRegionColumns = await hasOutingRegionColumns(context.env.DB)

  const insertStatements: D1PreparedStatement[] = []

  for (const outing of outings) {
    if (supportsRegionColumns) {
      insertStatements.push(
        context.env.DB
          .prepare(
            `INSERT INTO outing (id, userId, startTime, endTime, locationName, defaultLocationName, lat, lon, stateProvince, countryCode, protocol, numberObservers, allObsReported, effortDistanceMiles, effortAreaAcres, notes, createdAt)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)`
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
            outing.stateProvince ?? null,
            outing.countryCode ?? null,
            outing.protocol ?? null,
            outing.numberObservers ?? null,
            outing.allObsReported == null ? null : outing.allObsReported ? 1 : 0,
            outing.effortDistanceMiles ?? null,
            outing.effortAreaAcres ?? null,
            outing.notes,
            outing.createdAt
          )
      )
    } else {
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
  const newSpecies = dexUpdates.filter(row => !priorSpecies.has(row.speciesName)).length

  return Response.json({
    imported: {
      outings: outings.length,
      observations: observations.length,
      newSpecies,
    },
    dexUpdates: dexUpdates.map(row => ({
      ...row,
      addedDate: row.addedDate || undefined,
      bestPhotoId: row.bestPhotoId || undefined,
    })),
  })
 }
