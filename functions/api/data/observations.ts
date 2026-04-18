import { computeDex } from '../../lib/dex-query'
import { hasObservationColumn } from '../../lib/schema'
import { createRouteResponder } from '../../lib/log'

type ObservationCertainty = 'confirmed' | 'possible' | 'pending' | 'rejected'

type CreateObservationInput = {
  id: string
  outingId: string
  speciesName: string
  count: number
  certainty: ObservationCertainty
  representativePhotoId?: string
  aiConfidence?: number
  speciesComments?: string
  notes?: string
}

type ObservationPatch = {
  outingId?: string
  speciesName?: string
  count?: number
  certainty?: ObservationCertainty
  representativePhotoId?: string | null
  aiConfidence?: number | null
  speciesComments?: string
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
  if (typeof patch.speciesComments === 'string') {
    updateFields.push('speciesComments = ?')
    bindings.push(patch.speciesComments)
  }
  if (typeof patch.notes === 'string') {
    updateFields.push('notes = ?')
    bindings.push(patch.notes)
  }

  return { updateFields, bindings }
}

async function listObservationsByIds(db: D1Database, userId: string, ids: string[]) {
  if (ids.length === 0) return []

  const supportsSpeciesComments = await hasObservationColumn(db, 'speciesComments')
  const speciesCommentsSelect = supportsSpeciesComments ? 'speciesComments' : 'NULL as speciesComments'

  const placeholders = ids.map(() => '?').join(', ')
  const result = await db
    .prepare(
      `SELECT id, outingId, speciesName, count, certainty, representativePhotoId, aiConfidence, ${speciesCommentsSelect}, notes
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
      speciesComments?: string | null
      notes: string
    }>()

  return result.results.map(observation => ({
    ...observation,
    representativePhotoId: observation.representativePhotoId || undefined,
    aiConfidence: observation.aiConfidence ?? undefined,
    speciesComments: observation.speciesComments || undefined,
  }))
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
  const route = createRouteResponder((context.data as RequestData).log, 'data/observations/write', 'Application')
  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  let body: unknown
  try {
    body = await context.request.json()
    } catch {
    return route.fail(400, 'Invalid JSON body', 'Request body could not be parsed as JSON; check Content-Type is application/json and body is valid JSON')
  }

  if (!Array.isArray(body) || !body.every(isCreateObservationInput)) {
    return route.fail(400, 'Invalid observations payload', 'Observations payload failed validation; expected array of {id, outingId, speciesName, count, certainty}', { count: Array.isArray(body) ? body.length : 0 })
  }

  if (body.length === 0) {
    const dexUpdates = await computeDex(context.env.DB, userId)
    return Response.json({ observations: [], dexUpdates })
  }

  try {
    const outingIds = [...new Set(body.map(o => o.outingId))]
    const allOwned = await hasOwnedOutings(
      context.env.DB,
      userId,
      outingIds
    )
    if (!allOwned) {
      return route.fail(400, 'Invalid outing reference', `One or more outing IDs do not belong to the requesting user`, { outingIds })
    }

    const supportsSpeciesComments = await hasObservationColumn(context.env.DB, 'speciesComments')

    const statements = body.map(observation => {
      if (supportsSpeciesComments) {
        return context.env.DB.prepare(
          `INSERT INTO observation (id, outingId, userId, speciesName, count, certainty, representativePhotoId, aiConfidence, speciesComments, notes)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
        ).bind(
          observation.id,
          observation.outingId,
          userId,
          observation.speciesName,
          observation.count,
          observation.certainty,
          observation.representativePhotoId ?? null,
          observation.aiConfidence ?? null,
          observation.speciesComments ?? null,
          observation.notes ?? ''
        )
      }

      return context.env.DB.prepare(
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
    })

    await context.env.DB.batch(statements)
    const speciesNames = [...new Set(body.map(o => o.speciesName))]
    const scopedRoute = outingIds.length === 1
      ? createRouteResponder(route.log?.withResourceId(`outings/${outingIds[0]}/observations`), 'data/observations/write', 'Application')
      : route
    scopedRoute.info(`Inserted ${body.length} observations for ${speciesNames.length} species in ${outingIds.length} outings`, { observationCount: body.length, speciesCount: speciesNames.length, outingCount: outingIds.length })
    scopedRoute.debug('Observation insert details', { outingIds, speciesNames })

    const observations = body.map(observation => ({
      ...observation,
      representativePhotoId: observation.representativePhotoId || undefined,
      aiConfidence: observation.aiConfidence ?? undefined,
      speciesComments: supportsSpeciesComments ? (observation.speciesComments || undefined) : undefined,
      notes: observation.notes ?? '',
    }))

    const dexUpdates = await computeDex(context.env.DB, userId)
    return Response.json({ observations, dexUpdates })
    } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return route.fail(500, 'Internal server error', `Observation insert failed: ${message}`, { error: message, count: body.length })
  }
}

export const onRequestPatch: PagesFunction<Env> = async context => {
  const userId = (context.data as { user?: { id?: string } }).user?.id
  const route = createRouteResponder((context.data as RequestData).log, 'data/observations/write', 'Application')
  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  let body: unknown
  try {
    body = await context.request.json()
    } catch {
    return route.fail(400, 'Invalid JSON body', 'Request body could not be parsed as JSON; check Content-Type is application/json and body is valid JSON')
  }

  if (!isObject(body)) {
    return route.fail(400, 'Invalid patch payload', 'PATCH payload is not a valid object; expected {id, ...patch} or {ids, patch}')
  }

  try {
    const db = context.env.DB
    const supportsSpeciesComments = await hasObservationColumn(db, 'speciesComments')

    if (typeof body.id === 'string') {
    const { id, ...rawPatch } = body
    const patch = rawPatch as ObservationPatch
    const { updateFields, bindings } = getPatchBindings(patch)

    if (!supportsSpeciesComments) {
      const speciesIndex = updateFields.findIndex(field => field === 'speciesComments = ?')
      if (speciesIndex >= 0) {
        updateFields.splice(speciesIndex, 1)
        bindings.splice(speciesIndex, 1)
      }
    }

    if (updateFields.length === 0) {
      return route.fail(400, 'No valid fields to update', 'PATCH body contains no recognized fields; valid fields are outingId, speciesName, count, certainty, representativePhotoId, aiConfidence, speciesComments, notes')
    }

    if (typeof patch.outingId === 'string') {
      const hasOuting = await hasOwnedOutings(db, userId, [patch.outingId])
      if (!hasOuting) {
        return route.fail(400, 'Invalid outing reference', `Outing ${patch.outingId} is not owned by user or does not exist`, { outingId: patch.outingId })
      }
    }

    const updateResult = await db
      .prepare(`UPDATE observation SET ${updateFields.join(', ')} WHERE id = ? AND userId = ?`)
      .bind(...bindings, id, userId)
      .run()

    if (updateResult.meta.changes === 0) {
      return route.fail(404, 'Not found', `Observation ${id} not found or not owned by user`, { observationId: id })
    }

    const updated = await listObservationsByIds(db, userId, [id])
    const dexUpdates = await computeDex(db, userId)

    return Response.json({ observation: updated[0], dexUpdates })
    }

    if (Array.isArray(body.ids) && body.ids.every(id => typeof id === 'string') && isObject(body.patch)) {
    const ids = body.ids as string[]
    const patch = body.patch as ObservationPatch
    const { updateFields, bindings } = getPatchBindings(patch)

    if (!supportsSpeciesComments) {
      const speciesIndex = updateFields.findIndex(field => field === 'speciesComments = ?')
      if (speciesIndex >= 0) {
        updateFields.splice(speciesIndex, 1)
        bindings.splice(speciesIndex, 1)
      }
    }

    if (ids.length === 0) {
      return route.fail(400, 'No ids provided', 'Bulk PATCH requires at least one observation ID in the ids array', { count: 0 })
    }
    if (updateFields.length === 0) {
      return route.fail(400, 'No valid fields to update', 'Bulk PATCH body contains no recognized fields; valid fields are outingId, speciesName, count, certainty, representativePhotoId, aiConfidence, speciesComments, notes')
    }

    if (typeof patch.outingId === 'string') {
      const hasOuting = await hasOwnedOutings(db, userId, [patch.outingId])
      if (!hasOuting) {
        return route.fail(400, 'Invalid outing reference', `Outing ${patch.outingId} is not owned by user or does not exist`, { outingId: patch.outingId })
      }
    }

    const statements = ids.map(id =>
      db
        .prepare(`UPDATE observation SET ${updateFields.join(', ')} WHERE id = ? AND userId = ?`)
        .bind(...bindings, id, userId)
    )

    const updateResults = await db.batch(statements)
    const updatedCount = updateResults.reduce((sum, result) => sum + (result.meta?.changes || 0), 0)

    if (updatedCount === 0) {
      return route.fail(404, 'Not found', `None of the ${ids.length} observations were found or owned by user`, { count: ids.length })
    }

    const observations = await listObservationsByIds(db, userId, ids)
    const dexUpdates = await computeDex(db, userId)

    return Response.json({ observations, dexUpdates })
    }

    return route.fail(400, 'Invalid patch payload', 'PATCH payload does not match single-id or bulk-ids shape')
    } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return route.fail(500, 'Internal server error', `Observation patch failed: ${message}`, { error: message })
  }
}
