import { getOutingColumnNames } from '../../lib/schema'

type CreateOutingBody = {
  id: string
  startTime: string
  endTime: string
  locationName: string
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
  createdAt: string
}

function isValidCreateOutingBody(body: unknown): body is CreateOutingBody {
  if (!body || typeof body !== 'object') return false

  const data = body as Record<string, unknown>
  return (
    typeof data.id === 'string' &&
    typeof data.startTime === 'string' &&
    typeof data.endTime === 'string' &&
    typeof data.locationName === 'string' &&
    typeof data.createdAt === 'string'
  )
}

function normalizeCountryCode(countryCode?: string, stateProvince?: string): string | null {
  const direct = countryCode?.trim().toUpperCase()
  if (direct && direct.length === 2) return direct

  const stateValue = stateProvince?.trim().toUpperCase()
  if (!stateValue) return null
  const derived = stateValue.split('-')[0]
  return derived.length === 2 ? derived : null
}

export const onRequestPost: PagesFunction<Env> = async context => {
  const userId = (context.data as { user?: { id?: string } }).user?.id
  const log = (context.data as RequestData).log
  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  let body: unknown
  try {
    body = await context.request.json()
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  if (!isValidCreateOutingBody(body)) {
    return new Response('Invalid outing payload', { status: 400 })
  }

  const notes = body.notes ?? ''
  const stateProvince = body.stateProvince?.trim() || null
  const countryCode = normalizeCountryCode(body.countryCode, stateProvince || undefined)
  const protocol = body.protocol?.trim() || null
  const numberObservers =
    typeof body.numberObservers === 'number' && Number.isFinite(body.numberObservers)
      ? Math.max(0, Math.trunc(body.numberObservers))
      : null
  const allObsReported = typeof body.allObsReported === 'boolean' ? (body.allObsReported ? 1 : 0) : null
  const effortDistanceMiles =
    typeof body.effortDistanceMiles === 'number' && Number.isFinite(body.effortDistanceMiles)
      ? body.effortDistanceMiles
      : null
  const effortAreaAcres =
    typeof body.effortAreaAcres === 'number' && Number.isFinite(body.effortAreaAcres)
      ? body.effortAreaAcres
      : null
  const columnNames = await getOutingColumnNames(context.env.DB)
  const supportsRegionColumns = columnNames.has('stateProvince') && columnNames.has('countryCode')
  const supportsChecklistColumns =
    columnNames.has('protocol') &&
    columnNames.has('numberObservers') &&
    columnNames.has('allObsReported') &&
    columnNames.has('effortDistanceMiles') &&
    columnNames.has('effortAreaAcres')

  if (supportsRegionColumns && supportsChecklistColumns) {
    await context.env.DB.prepare(
      `INSERT INTO outing (id, userId, startTime, endTime, locationName, defaultLocationName, lat, lon, stateProvince, countryCode, protocol, numberObservers, allObsReported, effortDistanceMiles, effortAreaAcres, notes, createdAt)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)`
    )
      .bind(
        body.id,
        userId,
        body.startTime,
        body.endTime,
        body.locationName,
        body.defaultLocationName ?? null,
        body.lat ?? null,
        body.lon ?? null,
        stateProvince,
        countryCode,
        protocol,
        numberObservers,
        allObsReported,
        effortDistanceMiles,
        effortAreaAcres,
        notes,
        body.createdAt
      )
      .run()
  } else if (supportsRegionColumns) {
    await context.env.DB.prepare(
      `INSERT INTO outing (id, userId, startTime, endTime, locationName, defaultLocationName, lat, lon, stateProvince, countryCode, notes, createdAt)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`
    )
      .bind(
        body.id,
        userId,
        body.startTime,
        body.endTime,
        body.locationName,
        body.defaultLocationName ?? null,
        body.lat ?? null,
        body.lon ?? null,
        stateProvince,
        countryCode,
        notes,
        body.createdAt
      )
      .run()
  } else {
    await context.env.DB.prepare(
      `INSERT INTO outing (id, userId, startTime, endTime, locationName, defaultLocationName, lat, lon, notes, createdAt)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
    )
      .bind(
        body.id,
        userId,
        body.startTime,
        body.endTime,
        body.locationName,
        body.defaultLocationName ?? null,
        body.lat ?? null,
        body.lon ?? null,
        notes,
        body.createdAt
      )
      .run()
  }

  Object.assign((context.data as RequestData).requestProperties ?? {}, { outingId: body.id, location: body.locationName })
  void log

  return Response.json({
    id: body.id,
    userId,
    startTime: body.startTime,
    endTime: body.endTime,
    locationName: body.locationName,
    defaultLocationName: body.defaultLocationName,
    lat: body.lat,
    lon: body.lon,
    stateProvince: supportsRegionColumns ? (stateProvince ?? undefined) : undefined,
    countryCode: supportsRegionColumns ? (countryCode ?? undefined) : undefined,
    protocol: supportsChecklistColumns ? (protocol ?? undefined) : undefined,
    numberObservers: supportsChecklistColumns ? (numberObservers ?? undefined) : undefined,
    allObsReported:
      supportsChecklistColumns && typeof body.allObsReported === 'boolean' ? body.allObsReported : undefined,
    effortDistanceMiles: supportsChecklistColumns ? (effortDistanceMiles ?? undefined) : undefined,
    effortAreaAcres: supportsChecklistColumns ? (effortAreaAcres ?? undefined) : undefined,
    notes,
    createdAt: body.createdAt,
  })
}
