import { computeDex } from '../../lib/dex-query'

type OutingRow = {
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
}

type PhotoRow = {
  id: string
  outingId: string
  dataUrl: string
  thumbnail: string
  exifTime?: string | null
  gpsLat?: number | null
  gpsLon?: number | null
  fileHash: string
  fileName: string
}

type ObservationRow = {
  id: string
  outingId: string
  speciesName: string
  count: number
  certainty: 'confirmed' | 'possible' | 'pending' | 'rejected'
  representativePhotoId?: string | null
  aiConfidence?: number | null
  notes: string
}

export const onRequestGet: PagesFunction<Env> = async context => {
  const userId = (context.data as { user?: { id?: string } }).user?.id
  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  const db = context.env.DB

  const [outingsResult, photosResult, observationsResult, dex] = await Promise.all([
    db.prepare('SELECT * FROM outing WHERE userId = ? ORDER BY startTime DESC').bind(userId).all<OutingRow>(),
    db.prepare('SELECT id, outingId, dataUrl, thumbnail, exifTime, gpsLat, gpsLon, fileHash, fileName FROM photo WHERE userId = ?')
      .bind(userId)
      .all<PhotoRow>(),
    db.prepare('SELECT id, outingId, speciesName, count, certainty, representativePhotoId, aiConfidence, notes FROM observation WHERE userId = ?')
      .bind(userId)
      .all<ObservationRow>(),
    computeDex(db, userId),
  ])

  const outings = outingsResult.results.map(outing => ({
    ...outing,
    defaultLocationName: outing.defaultLocationName || undefined,
    lat: outing.lat ?? undefined,
    lon: outing.lon ?? undefined,
  }))

  const photos = photosResult.results.map(photo => ({
    id: photo.id,
    outingId: photo.outingId,
    dataUrl: photo.dataUrl,
    thumbnail: photo.thumbnail,
    exifTime: photo.exifTime || undefined,
    gps: photo.gpsLat != null && photo.gpsLon != null ? { lat: photo.gpsLat, lon: photo.gpsLon } : undefined,
    fileHash: photo.fileHash,
    fileName: photo.fileName,
  }))

  const observations = observationsResult.results.map(observation => ({
    ...observation,
    representativePhotoId: observation.representativePhotoId || undefined,
    aiConfidence: observation.aiConfidence ?? undefined,
  }))

  return Response.json({
    outings,
    photos,
    observations,
    dex: dex.map(entry => ({
      ...entry,
      addedDate: entry.addedDate || undefined,
      bestPhotoId: entry.bestPhotoId || undefined,
    })),
  })
}
