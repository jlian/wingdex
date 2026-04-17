import { computeDex } from '../../../lib/dex-query'
import { getOutingColumnNames } from '../../../lib/schema'

type UpdateOutingBody = {
  startTime?: string
  endTime?: string
  locationName?: string
  defaultLocationName?: string
  lat?: number
  lon?: number
  stateProvince?: string
  countryCode?: string
  protocol?: string
  numberObservers?: number
  allObsReported?: boolean
  effortDistanceMiles?: number
  effortAreaAcres?: number
  notes?: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

export const onRequestPatch: PagesFunction<Env> = async context => {
  const userId = (context.data as { user?: { id?: string } }).user?.id
  const log = (context.data as RequestData).log
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
  const columnNames = await getOutingColumnNames(context.env.DB)

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
  if ('stateProvince' in updates && columnNames.has('stateProvince')) {
    updateFields.push('stateProvince = ?')
    bindings.push(updates.stateProvince ?? null)
  }
  if ('countryCode' in updates && columnNames.has('countryCode')) {
    updateFields.push('countryCode = ?')
    bindings.push(updates.countryCode ? updates.countryCode.trim().toUpperCase() : null)
  }
  if ('protocol' in updates && columnNames.has('protocol')) {
    updateFields.push('protocol = ?')
    bindings.push(updates.protocol?.trim() || null)
  }
  if ('numberObservers' in updates && columnNames.has('numberObservers')) {
    updateFields.push('numberObservers = ?')
    bindings.push(
      typeof updates.numberObservers === 'number' && Number.isFinite(updates.numberObservers)
        ? Math.max(0, Math.trunc(updates.numberObservers))
        : null
    )
  }
  if ('allObsReported' in updates && columnNames.has('allObsReported')) {
    updateFields.push('allObsReported = ?')
    bindings.push(typeof updates.allObsReported === 'boolean' ? (updates.allObsReported ? 1 : 0) : null)
  }
  if ('effortDistanceMiles' in updates && columnNames.has('effortDistanceMiles')) {
    updateFields.push('effortDistanceMiles = ?')
    bindings.push(
      typeof updates.effortDistanceMiles === 'number' && Number.isFinite(updates.effortDistanceMiles)
        ? updates.effortDistanceMiles
        : null
    )
  }
  if ('effortAreaAcres' in updates && columnNames.has('effortAreaAcres')) {
    updateFields.push('effortAreaAcres = ?')
    bindings.push(
      typeof updates.effortAreaAcres === 'number' && Number.isFinite(updates.effortAreaAcres)
        ? updates.effortAreaAcres
        : null
    )
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
      stateProvince?: string | null
      countryCode?: string | null
      protocol?: string | null
      numberObservers?: number | null
      allObsReported?: number | null
      effortDistanceMiles?: number | null
      effortAreaAcres?: number | null
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
    stateProvince: outing.stateProvince ?? undefined,
    countryCode: outing.countryCode ?? undefined,
    protocol: outing.protocol ?? undefined,
    numberObservers: outing.numberObservers ?? undefined,
    allObsReported: outing.allObsReported == null ? undefined : outing.allObsReported === 1,
    effortDistanceMiles: outing.effortDistanceMiles ?? undefined,
    effortAreaAcres: outing.effortAreaAcres ?? undefined,
  })
}

export const onRequestDelete: PagesFunction<Env> = async context => {
  const userId = (context.data as { user?: { id?: string } }).user?.id
  const log = (context.data as RequestData).log
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
    log?.warn('data.outings.notFound', { resultType: 'Failed', resultSignature: 404, resultDescription: `Outing ${outingId} not found or not owned by user`, properties: { outingId } })
    return new Response('Not found', { status: 404 })
  }

  Object.assign((context.data as RequestData).requestProperties ?? {}, { outingId })
  const dexUpdates = await computeDex(context.env.DB, userId)
  return Response.json({ dexUpdates })
}
