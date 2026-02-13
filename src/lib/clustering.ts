import type { Photo, Outing } from './types'

interface PhotoCluster {
  photos: Photo[]
  startTime: Date
  endTime: Date
  centerLat?: number
  centerLon?: number
}

const TIME_THRESHOLD_MS = 5 * 60 * 60 * 1000
const MAX_DISTANCE_KM = 6

function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export function clusterPhotosIntoOutings(photos: Photo[]): PhotoCluster[] {
  if (photos.length === 0) return []

  const sortedPhotos = [...photos].sort((a, b) => {
    const timeA = a.exifTime ? new Date(a.exifTime).getTime() : Number.POSITIVE_INFINITY
    const timeB = b.exifTime ? new Date(b.exifTime).getTime() : Number.POSITIVE_INFINITY
    return timeA - timeB
  })
  
  const clusters: PhotoCluster[] = []
  let currentCluster: Photo[] = [sortedPhotos[0]]
  
  for (let i = 1; i < sortedPhotos.length; i++) {
    const photo = sortedPhotos[i]
    const lastPhoto = currentCluster[currentCluster.length - 1]
    
    const photoTime = photo.exifTime ? new Date(photo.exifTime).getTime() : null
    const lastTime = lastPhoto.exifTime ? new Date(lastPhoto.exifTime).getTime() : null
    const timeDiff = photoTime !== null && lastTime !== null ? photoTime - lastTime : 0
    
    let shouldCluster = timeDiff <= TIME_THRESHOLD_MS
    
    if (shouldCluster && photo.gps && lastPhoto.gps) {
      const distance = haversineDistance(
        lastPhoto.gps.lat,
        lastPhoto.gps.lon,
        photo.gps.lat,
        photo.gps.lon
      )
      shouldCluster = distance <= MAX_DISTANCE_KM
    }
    
    if (shouldCluster) {
      currentCluster.push(photo)
    } else {
      clusters.push(createClusterFromPhotos(currentCluster))
      currentCluster = [photo]
    }
  }
  
  if (currentCluster.length > 0) {
    clusters.push(createClusterFromPhotos(currentCluster))
  }
  
  return clusters
}

function createClusterFromPhotos(photos: Photo[]): PhotoCluster {
  const exifTimes = photos
    .map(photo => (photo.exifTime ? new Date(photo.exifTime).getTime() : null))
    .filter((time): time is number => time !== null)
    .sort((a, b) => a - b)

  const fallbackNow = Date.now()
  const start = exifTimes[0] ?? fallbackNow
  const end = exifTimes[exifTimes.length - 1] ?? fallbackNow
  
  const photosWithGps = photos.filter(p => p.gps)
  let centerLat: number | undefined
  let centerLon: number | undefined
  
  if (photosWithGps.length > 0) {
    centerLat = photosWithGps.reduce((sum, p) => sum + p.gps!.lat, 0) / photosWithGps.length
    centerLon = photosWithGps.reduce((sum, p) => sum + p.gps!.lon, 0) / photosWithGps.length
  }
  
  return {
    photos,
    startTime: new Date(start),
    endTime: new Date(end),
    centerLat,
    centerLon
  }
}

/**
 * Try to match a photo cluster to an existing outing.
 * Returns the outing ID if there's a time+location overlap, otherwise undefined.
 * 
 * Match criteria:
 * - Cluster time overlaps the outing window ±5 hours
 * - If both have GPS, distance is within 6km
 */
export function findMatchingOuting(
  cluster: PhotoCluster,
  outings: Outing[]
): Outing | undefined {
  for (const outing of outings) {
    const outingStart = new Date(outing.startTime).getTime()
    const outingEnd = new Date(outing.endTime).getTime()
    const clusterStart = cluster.startTime.getTime()
    const clusterEnd = cluster.endTime.getTime()

    // Check time overlap: cluster within ±5 hours of outing window
    const timeOverlap =
      clusterStart <= outingEnd + TIME_THRESHOLD_MS &&
      clusterEnd >= outingStart - TIME_THRESHOLD_MS

    if (!timeOverlap) continue

    // If both have GPS, check distance
    if (
      cluster.centerLat !== undefined &&
      cluster.centerLon !== undefined &&
      outing.lat !== undefined &&
      outing.lon !== undefined
    ) {
      const dist = haversineDistance(
        cluster.centerLat, cluster.centerLon,
        outing.lat, outing.lon
      )
      if (dist > MAX_DISTANCE_KM) continue
    }

    return outing
  }
  return undefined
}

export function formatOutingTime(startTime: string, endTime: string): string {
  const start = new Date(startTime)
  const end = new Date(endTime)
  
  const sameDay = start.toDateString() === end.toDateString()
  
  if (sameDay) {
    return `${start.toLocaleDateString()} ${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  }
  
  return `${start.toLocaleDateString()} ${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleDateString()} ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}
