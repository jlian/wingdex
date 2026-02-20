import { computeDex } from '../../lib/dex-query'

type ObservationCertainty = 'confirmed' | 'possible' | 'pending' | 'rejected'

type CreateObservationInput = {
  id: string
  outingId: string
  speciesName: string
  count: number
  certainty: ObservationCertainty
  representativePhotoId?: string
  aiConfidence?: number
  notes?: string
}

type ObservationPatch = {
  outingId?: string
  speciesName?: string
  count?: number
  certainty?: ObservationCertainty
  representativePhotoId?: string | null
  aiConfidence?: number | null
  notes?: string
}

function isCertainty(value: unknown): value is ObservationCertainty {
  return value === 'confirmed' || value === 'possible' || value === 'pending' || value === 'rejected'
}

function isCreateObservationInput(value: unknown): value is CreateObservationInput {
  if (!value || typeof value !== 'object') return false
  const data = value as Record<string, unknown>

  return (
    typeof data.id === 'string' &&
    typeof data.outingId === 'string' &&
    typeof data.speciesName === 'string' &&
    typeof data.count === 'number' &&
    isCertainty(data.certainty)
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function getPatchBindings(patch: ObservationPatch): {
  updateFields: string[]
  bindings: Array<string | number | null>
} {
  const updateFields: string[] = []
  const bindings: Array<string | number | null> = []

  if (typeof patch.outingId === 'string') {
    updateFields.push('outingId = ?')
    bindings.push(patch.outingId)
  }
  if (typeof patch.speciesName === 'string') {
    updateFields.push('speciesName = ?')
    bindings.push(patch.speciesName)
  }
  if (typeof patch.count === 'number') {
    updateFields.push('count = ?')
    bindings.push(patch.count)
  }
  if (patch.certainty && isCertainty(patch.certainty)) {
    updateFields.push('certainty = ?')
    bindings.push(patch.certainty)
  }
  if ('representativePhotoId' in patch) {
    updateFields.push('representativePhotoId = ?')
    bindings.push(patch.representativePhotoId ?? null)
  }
  if ('aiConfidence' in patch) {
    updateFields.push('aiConfidence = ?')
    bindings.push(patch.aiConfidence ?? null)
  }
  if (typeof patch.notes === 'string') {
    updateFields.push('notes = ?')
    bindings.push(patch.notes)
  }

  return { updateFields, bindings }
}

async function listObservationsByIds(db: D1Database, userId: string, ids: string[]) {
  if (ids.length === 0) return []

  const placeholders = ids.map(() => '?').join(', ')
  const result = await db
    .prepare(
      `SELECT id, outingId, speciesName, count, certainty, representativePhotoId, aiConfidence, notes
       FROM observation
       WHERE userId = ? AND id IN (${placeholders})`
    )
    .bind(userId, ...ids)
    .all<{
      id: string
      outingId: string
      speciesName: string
      count: number
      certainty: ObservationCertainty
      representativePhotoId?: string | null
      aiConfidence?: number | null
      notes: string
    }>()

  return result.results.map(observation => ({
    ...observation,
    representativePhotoId: observation.representativePhotoId || undefined,
    aiConfidence: observation.aiConfidence ?? undefined,
  }))
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

  if (!Array.isArray(body) || !body.every(isCreateObservationInput)) {
    return new Response('Invalid observations payload', { status: 400 })
  }

  if (body.length === 0) {
    const dexUpdates = await computeDex(context.env.DB, userId)
    return Response.json({ observations: [], dexUpdates })
  }

  const statements = body.map(observation =>
    context.env.DB.prepare(
      `INSERT INTO observation (id, outingId, userId, speciesName, count, certainty, representativePhotoId, aiConfidence, notes)
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

  await context.env.DB.batch(statements)

  const observations = body.map(observation => ({
    ...observation,
    representativePhotoId: observation.representativePhotoId || undefined,
    aiConfidence: observation.aiConfidence ?? undefined,
    notes: observation.notes ?? '',
  }))

  const dexUpdates = await computeDex(context.env.DB, userId)
  return Response.json({ observations, dexUpdates })
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

  if (!isObject(body)) {
    return new Response('Invalid patch payload', { status: 400 })
  }

  const db = context.env.DB

  if (typeof body.id === 'string') {
    const { id, ...rawPatch } = body
    const patch = rawPatch as ObservationPatch
    const { updateFields, bindings } = getPatchBindings(patch)

    if (updateFields.length === 0) {
      return new Response('No valid fields to update', { status: 400 })
    }

    const updateResult = await db
      .prepare(`UPDATE observation SET ${updateFields.join(', ')} WHERE id = ? AND userId = ?`)
      .bind(...bindings, id, userId)
      .run()

    if (updateResult.meta.changes === 0) {
      return new Response('Not found', { status: 404 })
    }

    const updated = await listObservationsByIds(db, userId, [id])
    const dexUpdates = await computeDex(db, userId)

    return Response.json({ observation: updated[0], dexUpdates })
  }

  if (Array.isArray(body.ids) && body.ids.every(id => typeof id === 'string') && isObject(body.patch)) {
    const ids = body.ids as string[]
    const patch = body.patch as ObservationPatch
    const { updateFields, bindings } = getPatchBindings(patch)

    if (ids.length === 0) {
      return new Response('No ids provided', { status: 400 })
    }
    if (updateFields.length === 0) {
      return new Response('No valid fields to update', { status: 400 })
    }

    const statements = ids.map(id =>
      db
        .prepare(`UPDATE observation SET ${updateFields.join(', ')} WHERE id = ? AND userId = ?`)
        .bind(...bindings, id, userId)
    )

    const updateResults = await db.batch(statements)
    const updatedCount = updateResults.reduce((sum, result) => sum + (result.meta?.changes || 0), 0)

    if (updatedCount === 0) {
      return new Response('Not found', { status: 404 })
    }

    const observations = await listObservationsByIds(db, userId, ids)
    const dexUpdates = await computeDex(db, userId)

    return Response.json({ observations, dexUpdates })
  }

  return new Response('Invalid patch payload', { status: 400 })
}
