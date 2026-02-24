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
  stateProvince?: string | null
  countryCode?: string | null
  protocol?: string | null
  numberObservers?: number | null
  allObsReported?: number | null
  effortDistanceMiles?: number | null
  effortAreaAcres?: number | null
  notes: string
  createdAt: string
}

type PhotoRow = {
  id: string
  outingId: string
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
  speciesComments?: string | null
  notes: string
}

async function hasSpeciesCommentsColumn(db: D1Database): Promise<boolean> {
  const info = await db.prepare("PRAGMA table_info('observation')").all<{ name: string }>()
  const names = new Set(info.results.map(column => column.name))
  return names.has('speciesComments')
}

export const onRequestGet: PagesFunction<Env> = async context => {
  const userId = (context.data as { user?: { id?: string } }).user?.id
  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  const db = context.env.DB
  const supportsSpeciesComments = await hasSpeciesCommentsColumn(db)
  const observationSpeciesCommentsSelect = supportsSpeciesComments
    ? 'speciesComments'
    : 'NULL as speciesComments'

  const [outingsResult, photosResult, observationsResult, dex] = await Promise.all([
    db.prepare('SELECT * FROM outing WHERE userId = ? ORDER BY startTime DESC').bind(userId).all<OutingRow>(),
    db.prepare('SELECT id, outingId, exifTime, gpsLat, gpsLon, fileHash, fileName FROM photo WHERE userId = ?')
      .bind(userId)
      .all<PhotoRow>(),
    db.prepare(`SELECT id, outingId, speciesName, count, certainty, representativePhotoId, aiConfidence, ${observationSpeciesCommentsSelect}, notes FROM observation WHERE userId = ?`)
      .bind(userId)
      .all<ObservationRow>(),
    computeDex(db, userId),
  ])

  const outings = outingsResult.results.map(outing => ({
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
  }))

  const photos = photosResult.results.map(photo => ({
    id: photo.id,
    outingId: photo.outingId,
    dataUrl: '',
    thumbnail: '',
    exifTime: photo.exifTime || undefined,
    gps: photo.gpsLat != null && photo.gpsLon != null ? { lat: photo.gpsLat, lon: photo.gpsLon } : undefined,
    fileHash: photo.fileHash,
    fileName: photo.fileName,
  }))

  const observations = observationsResult.results.map(observation => ({
    ...observation,
    representativePhotoId: observation.representativePhotoId || undefined,
    aiConfidence: observation.aiConfidence ?? undefined,
    speciesComments: observation.speciesComments || undefined,
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
