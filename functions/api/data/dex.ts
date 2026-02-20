import { computeDex } from '../../lib/dex-query'

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
  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  const dex = await computeDex(context.env.DB, userId)
  return Response.json(
    dex.map(entry => ({
      ...entry,
      addedDate: entry.addedDate || undefined,
      bestPhotoId: entry.bestPhotoId || undefined,
    }))
  )
}

export const onRequestPatch: PagesFunction<Env> = async context => {
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

  const patches = Array.isArray(body) ? body : [body]
  if (!patches.every(isDexMetaPatch)) {
    return new Response('Invalid dex patch payload', { status: 400 })
  }

  for (const patch of patches) {
    await upsertDexMetaPatch(context.env.DB, userId, patch)
  }

  const dexUpdates = await computeDex(context.env.DB, userId)
  return Response.json({
    dexUpdates: dexUpdates.map(entry => ({
      ...entry,
      addedDate: entry.addedDate || undefined,
      bestPhotoId: entry.bestPhotoId || undefined,
    })),
  })
}
