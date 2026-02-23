type CreateOutingBody = {
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

  if (!isValidCreateOutingBody(body)) {
    return new Response('Invalid outing payload', { status: 400 })
  }

  const notes = body.notes ?? ''

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

  return Response.json({
    id: body.id,
    userId,
    startTime: body.startTime,
    endTime: body.endTime,
    locationName: body.locationName,
    defaultLocationName: body.defaultLocationName,
    lat: body.lat,
    lon: body.lon,
    notes,
    createdAt: body.createdAt,
  })
}
