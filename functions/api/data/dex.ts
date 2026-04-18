import { computeDex } from '../../lib/dex-query'
import { createRouteResponder } from '../../lib/log'

type DexMetaPatch = {
  speciesName: string
  addedDate?: string | null
  bestPhotoId?: string | null
  notes?: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function isDexMetaPatch(value: unknown): value is DexMetaPatch {
  if (!isObject(value)) return false
  return typeof value.speciesName === 'string'
}

async function upsertDexMetaPatch(db: D1Database, userId: string, patch: DexMetaPatch) {
  const existingResult = await db
    .prepare('SELECT addedDate, bestPhotoId, notes FROM dex_meta WHERE userId = ? AND speciesName = ? LIMIT 1')
    .bind(userId, patch.speciesName)
    .all<{ addedDate?: string | null; bestPhotoId?: string | null; notes?: string | null }>()

  const existing = existingResult.results[0]

  const nextAddedDate = 'addedDate' in patch ? patch.addedDate ?? null : (existing?.addedDate ?? null)
  const nextBestPhotoId = 'bestPhotoId' in patch ? patch.bestPhotoId ?? null : (existing?.bestPhotoId ?? null)
  const nextNotes = typeof patch.notes === 'string' ? patch.notes : (existing?.notes ?? '')

  await db
    .prepare(
      `INSERT INTO dex_meta (userId, speciesName, addedDate, bestPhotoId, notes)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(userId, speciesName)
       DO UPDATE SET
         addedDate = excluded.addedDate,
         bestPhotoId = excluded.bestPhotoId,
         notes = excluded.notes`
    )
    .bind(userId, patch.speciesName, nextAddedDate, nextBestPhotoId, nextNotes)
    .run()
}

export const onRequestGet: PagesFunction<Env> = async context => {
  const userId = (context.data as { user?: { id?: string } }).user?.id
  const route = createRouteResponder((context.data as RequestData).log?.withResourceId('dex'), 'data/dex/read', 'Application')
  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const dex = await computeDex(context.env.DB, userId)
    route.debug(`Computed dex with ${dex.length} species`, { speciesCount: dex.length })
  return Response.json(
    dex.map(entry => ({
      ...entry,
      addedDate: entry.addedDate || undefined,
      bestPhotoId: entry.bestPhotoId || undefined,
    }))
  )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return route.fail(500, 'Internal server error', `Dex read failed: ${message}`, { error: message })
  }
}

export const onRequestPatch: PagesFunction<Env> = async context => {
  const userId = (context.data as { user?: { id?: string } }).user?.id
  const route = createRouteResponder((context.data as RequestData).log?.withResourceId('dex'), 'data/dex/write', 'Application')
  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  let body: unknown
  try {
    body = await context.request.json()
  } catch {
    return route.fail(400, 'Invalid JSON body')
  }

  const patches = Array.isArray(body) ? body : [body]
  if (!patches.every(isDexMetaPatch)) {
    return route.fail(400, 'Invalid dex patch payload', 'Dex patch payload failed validation; expected {speciesName} with optional addedDate, bestPhotoId, notes')
  }

  try {
    for (const patch of patches) {
      await upsertDexMetaPatch(context.env.DB, userId, patch)
    }
    route.debug(`Upserted ${patches.length} dex metadata patches`, { patchCount: patches.length, speciesNames: patches.map(p => p.speciesName) })

    const dexUpdates = await computeDex(context.env.DB, userId)
    return Response.json({
      dexUpdates: dexUpdates.map(entry => ({
        ...entry,
        addedDate: entry.addedDate || undefined,
        bestPhotoId: entry.bestPhotoId || undefined,
      })),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return route.fail(500, 'Internal server error', `Dex patch failed: ${message}`, { error: message })
  }
}
