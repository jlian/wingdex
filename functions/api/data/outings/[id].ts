import { computeDex } from '../../../lib/dex-query'

type UpdateOutingBody = {
  startTime?: string
  endTime?: string
  locationName?: string
  defaultLocationName?: string
  lat?: number
  lon?: number
  notes?: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

export const onRequestPatch: PagesFunction<Env> = async context => {
  const userId = (context.data as { user?: { id?: string } }).user?.id
  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  const outingId = context.params.id as string | undefined
  if (!outingId) {
    return new Response('Missing outing id', { status: 400 })
  }

  let body: unknown
  try {
    body = await context.request.json()
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  if (!isObject(body)) {
    return new Response('Invalid outing patch payload', { status: 400 })
  }

  const updates = body as UpdateOutingBody
  const updateFields: string[] = []
  const bindings: Array<string | number | null> = []

  if (typeof updates.startTime === 'string') {
    updateFields.push('startTime = ?')
    bindings.push(updates.startTime)
  }
  if (typeof updates.endTime === 'string') {
    updateFields.push('endTime = ?')
    bindings.push(updates.endTime)
  }
  if (typeof updates.locationName === 'string') {
    updateFields.push('locationName = ?')
    bindings.push(updates.locationName)
  }
  if ('defaultLocationName' in updates) {
    updateFields.push('defaultLocationName = ?')
    bindings.push(updates.defaultLocationName ?? null)
  }
  if ('lat' in updates) {
    updateFields.push('lat = ?')
    bindings.push(updates.lat ?? null)
  }
  if ('lon' in updates) {
    updateFields.push('lon = ?')
    bindings.push(updates.lon ?? null)
  }
  if (typeof updates.notes === 'string') {
    updateFields.push('notes = ?')
    bindings.push(updates.notes)
  }

  if (updateFields.length === 0) {
    return new Response('No valid fields to update', { status: 400 })
  }

  const updateStatement = `UPDATE outing SET ${updateFields.join(', ')} WHERE id = ? AND userId = ?`
  const updateResult = await context.env.DB.prepare(updateStatement)
    .bind(...bindings, outingId, userId)
    .run()

  if (updateResult.meta.changes === 0) {
    return new Response('Not found', { status: 404 })
  }

  const outingResult = await context.env.DB.prepare(
    'SELECT * FROM outing WHERE id = ? AND userId = ? LIMIT 1'
  )
    .bind(outingId, userId)
    .all<{
      id: string
      userId: string
      startTime: string
      endTime: string
      locationName: string
      defaultLocationName?: string | null
      lat?: number | null
      lon?: number | null
      notes: string
      createdAt: string
    }>()

  const outing = outingResult.results[0]
  if (!outing) {
    return new Response('Not found', { status: 404 })
  }

  return Response.json({
    ...outing,
    defaultLocationName: outing.defaultLocationName || undefined,
    lat: outing.lat ?? undefined,
    lon: outing.lon ?? undefined,
  })
}

export const onRequestDelete: PagesFunction<Env> = async context => {
  const userId = (context.data as { user?: { id?: string } }).user?.id
  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  const outingId = context.params.id as string | undefined
  if (!outingId) {
    return new Response('Missing outing id', { status: 400 })
  }

  const deleteResult = await context.env.DB.prepare('DELETE FROM outing WHERE id = ? AND userId = ?')
    .bind(outingId, userId)
    .run()

  if (deleteResult.meta.changes === 0) {
    return new Response('Not found', { status: 404 })
  }

  const dexUpdates = await computeDex(context.env.DB, userId)
  return Response.json({ dexUpdates })
}
