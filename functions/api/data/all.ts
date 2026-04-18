import { computeDex } from '../../lib/dex-query'
import { hasObservationColumn } from '../../lib/schema'
import { getWikiMetadata } from '../../lib/taxonomy'

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

export const onRequestGet: PagesFunction<Env> = async context => {
  const userId = (context.data as { user?: { id?: string } }).user?.id
  const log = (context.data as RequestData).log
  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  const db = context.env.DB
  const supportsSpeciesComments = await hasObservationColumn(db, 'speciesComments')
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

  log?.info('data/all/read', { category: 'Application', resultDescription: `Fetched ${outings.length} outings, ${photos.length} photos, ${observations.length} observations, ${dex.length} dex entries`, properties: { outingCount: outings.length, photoCount: photos.length, observationCount: observations.length, dexCount: dex.length } })

  return Response.json({
    outings,
    photos,
    observations,
    dex: dex.map(entry => {
      const { wikiTitle, thumbnailUrl } = getWikiMetadata(entry.speciesName)
      return {
        ...entry,
        addedDate: entry.addedDate || undefined,
        bestPhotoId: entry.bestPhotoId || undefined,
        wikiTitle,
        thumbnailUrl,
      }
    }),
  })
}
