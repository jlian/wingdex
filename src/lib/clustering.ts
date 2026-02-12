import type { Photo, Outing } from './types'

interface PhotoCluster {
  photos: Photo[]
  startTime: Date
  endTime: Date
  centerLat?: number
  centerLon?: number
}

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000
const MAX_DISTANCE_KM = 5

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
    const timeA = a.exifTime ? new Date(a.exifTime).getTime() : Date.now()
    const timeB = b.exifTime ? new Date(b.exifTime).getTime() : Date.now()
    return timeA - timeB
  })
  
  const clusters: PhotoCluster[] = []
  let currentCluster: Photo[] = [sortedPhotos[0]]
  
  for (let i = 1; i < sortedPhotos.length; i++) {
    const photo = sortedPhotos[i]
    const lastPhoto = currentCluster[currentCluster.length - 1]
    
    const photoTime = photo.exifTime ? new Date(photo.exifTime).getTime() : Date.now()
    const lastTime = lastPhoto.exifTime ? new Date(lastPhoto.exifTime).getTime() : Date.now()
    const timeDiff = photoTime - lastTime
    
    let shouldCluster = timeDiff <= FOUR_HOURS_MS
    
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
  const times = photos
    .map(p => p.exifTime ? new Date(p.exifTime).getTime() : Date.now())
    .sort((a, b) => a - b)
  
  const photosWithGps = photos.filter(p => p.gps)
  let centerLat: number | undefined
  let centerLon: number | undefined
  
  if (photosWithGps.length > 0) {
    centerLat = photosWithGps.reduce((sum, p) => sum + p.gps!.lat, 0) / photosWithGps.length
    centerLon = photosWithGps.reduce((sum, p) => sum + p.gps!.lon, 0) / photosWithGps.length
  }
  
  return {
    photos,
    startTime: new Date(times[0]),
    endTime: new Date(times[times.length - 1]),
    centerLat,
    centerLon
  }
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
