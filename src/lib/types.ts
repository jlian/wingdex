export interface Photo {
  id: string
  outingId: string
  dataUrl: string
  thumbnail: string
  exifTime?: string
  gps?: { lat: number; lon: number }
  fileHash: string
  fileName: string
}

export interface Outing {
  id: string
  userId: string
  startTime: string
  endTime: string
  locationName: string
  lat?: number
  lon?: number
  notes: string
  createdAt: string
}

export type ObservationStatus = 'confirmed' | 'possible' | 'pending' | 'rejected'

export interface Observation {
  id: string
  outingId: string
  speciesName: string
  count: number
  certainty: ObservationStatus
  representativePhotoId?: string
  aiConfidence?: number
  notes: string
}

export interface LifeListEntry {
  speciesName: string
  firstSeenDate: string
  lastSeenDate: string
  /** When this species was first added to BirdDex (wall-clock time) */
  addedDate?: string
  totalOutings: number
  totalCount: number
  bestPhotoId?: string
  notes: string
}

export interface SavedSpot {
  id: string
  name: string
  lat: number
  lon: number
  createdAt: string
}

export interface ImportPreview {
  speciesName: string
  date: string
  location: string
  count: number
  conflict?: 'duplicate' | 'update_dates' | 'new'
  existingEntry?: LifeListEntry
}
