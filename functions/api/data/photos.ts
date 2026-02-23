type CreatePhotoInput = {
  id: string
  outingId: string
  dataUrl?: string
  thumbnail?: string
  exifTime?: string
  gps?: { lat: number; lon: number }
  fileHash: string
  fileName: string
}

function isCreatePhotoInput(value: unknown): value is CreatePhotoInput {
  if (!value || typeof value !== 'object') return false
  const data = value as Record<string, unknown>

  return (
    typeof data.id === 'string' &&
    typeof data.outingId === 'string' &&
    (data.dataUrl === undefined || typeof data.dataUrl === 'string') &&
    (data.thumbnail === undefined || typeof data.thumbnail === 'string') &&
    typeof data.fileHash === 'string' &&
    typeof data.fileName === 'string'
  )
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

  if (!Array.isArray(body) || !body.every(isCreatePhotoInput)) {
    return new Response('Invalid photos payload', { status: 400 })
  }

  if (body.length === 0) {
    return Response.json([])
  }

  const allOwned = await hasOwnedOutings(
    context.env.DB,
    userId,
    body.map(photo => photo.outingId)
  )
  if (!allOwned) {
    return new Response('Invalid outing reference', { status: 400 })
  }

  const statements = body.map(photo =>
    context.env.DB.prepare(
      `INSERT INTO photo (id, outingId, userId, dataUrl, thumbnail, exifTime, gpsLat, gpsLon, fileHash, fileName)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
    ).bind(
      photo.id,
      photo.outingId,
      userId,
      '',
      '',
      photo.exifTime ?? null,
      photo.gps?.lat ?? null,
      photo.gps?.lon ?? null,
      photo.fileHash,
      photo.fileName
    )
  )

  await context.env.DB.batch(statements)

  return Response.json(
    body.map(photo => ({
      ...photo,
      exifTime: photo.exifTime || undefined,
      gps: photo.gps ? { lat: photo.gps.lat, lon: photo.gps.lon } : undefined,
    }))
  )
}
