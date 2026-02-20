import { computeDex } from '../../lib/dex-query'

type SeedOuting = {
  id: string
  startTime: string
  endTime: string
  locationName: string
  defaultLocationName?: string
  lat?: number
  lon?: number
  notes?: string
  createdAt: string
}

type SeedObservation = {
  id: string
  outingId: string
  speciesName: string
  count: number
  certainty: 'confirmed' | 'possible' | 'pending' | 'rejected'
  representativePhotoId?: string
  aiConfidence?: number
  notes?: string
}

type SeedDexMeta = {
  speciesName: string
  addedDate?: string
  bestPhotoId?: string
  notes?: string
}

type SeedBody = {
  outings?: SeedOuting[]
  observations?: SeedObservation[]
  dex?: SeedDexMeta[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function isSeedOuting(value: unknown): value is SeedOuting {
  if (!isObject(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.startTime === 'string' &&
    typeof value.endTime === 'string' &&
    typeof value.locationName === 'string' &&
    typeof value.createdAt === 'string'
  )
}

function isSeedObservation(value: unknown): value is SeedObservation {
  if (!isObject(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.outingId === 'string' &&
    typeof value.speciesName === 'string' &&
    typeof value.count === 'number' &&
    (value.certainty === 'confirmed' || value.certainty === 'possible' || value.certainty === 'pending' || value.certainty === 'rejected')
  )
}

function isSeedDexMeta(value: unknown): value is SeedDexMeta {
  return isObject(value) && typeof value.speciesName === 'string'
}

async function hasOwnedOutings(db: D1Database, userId: string, outingIds: string[]): Promise<boolean> {
  const uniqueOutingIds = Array.from(new Set(outingIds))
  if (uniqueOutingIds.length === 0) return true

  const placeholders = uniqueOutingIds.map(() => '?').join(', ')
  const result = await db
    .prepare(`SELECT id FROM outing WHERE userId = ? AND id IN (${placeholders})`)
    .bind(userId, ...uniqueOutingIds)
    .all<{ id: string }>()

  return result.results.length === uniqueOutingIds.length
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

  if (!isObject(body)) {
    return new Response('Invalid seed payload', { status: 400 })
  }

  const seed = body as SeedBody
  const outings = seed.outings ?? []
  const observations = seed.observations ?? []
  const dex = seed.dex ?? []

  if (!Array.isArray(outings) || !outings.every(isSeedOuting)) {
    return new Response('Invalid outings payload', { status: 400 })
  }
  if (!Array.isArray(observations) || !observations.every(isSeedObservation)) {
    return new Response('Invalid observations payload', { status: 400 })
  }
  if (!Array.isArray(dex) || !dex.every(isSeedDexMeta)) {
    return new Response('Invalid dex payload', { status: 400 })
  }

  const seededOutingIds = new Set(outings.map(outing => outing.id))
  const referencedExistingOutingIds = observations
    .map(observation => observation.outingId)
    .filter(outingId => !seededOutingIds.has(outingId))

  const existingOutingsOwned = await hasOwnedOutings(context.env.DB, userId, referencedExistingOutingIds)
  if (!existingOutingsOwned) {
    return new Response('Invalid outing reference in observations payload', { status: 400 })
  }

  const statements: D1PreparedStatement[] = []

  for (const outing of outings) {
    statements.push(
      context.env.DB.prepare(
        `INSERT OR REPLACE INTO outing (id, userId, startTime, endTime, locationName, defaultLocationName, lat, lon, notes, createdAt)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
      ).bind(
        outing.id,
        userId,
        outing.startTime,
        outing.endTime,
        outing.locationName,
        outing.defaultLocationName ?? null,
        outing.lat ?? null,
        outing.lon ?? null,
        outing.notes ?? '',
        outing.createdAt
      )
    )
  }

  for (const observation of observations) {
    statements.push(
      context.env.DB.prepare(
        `INSERT OR REPLACE INTO observation (id, outingId, userId, speciesName, count, certainty, representativePhotoId, aiConfidence, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
      ).bind(
        observation.id,
        observation.outingId,
        userId,
        observation.speciesName,
        observation.count,
        observation.certainty,
        observation.representativePhotoId ?? null,
        observation.aiConfidence ?? null,
        observation.notes ?? ''
      )
    )
  }

  for (const entry of dex) {
    statements.push(
      context.env.DB.prepare(
        `INSERT INTO dex_meta (userId, speciesName, addedDate, bestPhotoId, notes)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(userId, speciesName)
         DO UPDATE SET
           addedDate = excluded.addedDate,
           bestPhotoId = excluded.bestPhotoId,
           notes = excluded.notes`
      ).bind(userId, entry.speciesName, entry.addedDate ?? null, entry.bestPhotoId ?? null, entry.notes ?? '')
    )
  }

  if (statements.length > 0) {
    await context.env.DB.batch(statements)
  }

  const dexUpdates = await computeDex(context.env.DB, userId)

  return Response.json({
    imported: {
      outings: outings.length,
      observations: observations.length,
      dexMeta: dex.length,
    },
    dexUpdates: dexUpdates.map(row => ({
      ...row,
      addedDate: row.addedDate || undefined,
      bestPhotoId: row.bestPhotoId || undefined,
    })),
  })
}
