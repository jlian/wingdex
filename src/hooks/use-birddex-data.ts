import { useKV } from '@github/spark/hooks'
import { useEffect, useRef } from 'react'
import type { Photo, Outing, Observation, LifeListEntry, SavedSpot } from '@/lib/types'

export function useBirdDexData() {
  const [photos, setPhotos] = useKV<Photo[]>('photos', [])
  const [outings, setOutings] = useKV<Outing[]>('outings', [])
  const [observations, setObservations] = useKV<Observation[]>('observations', [])
  const [lifeList, setLifeList] = useKV<LifeListEntry[]>('lifeList', [])
  const [savedSpots, setSavedSpots] = useKV<SavedSpot[]>('savedSpots', [])
  const [syncTrigger, setSyncTrigger] = useKV<number>('sync-trigger', 0)
  
  const triggerSync = () => {
    setSyncTrigger(current => (current || 0) + 1)
  }

  const addPhotos = (newPhotos: Photo[]) => {
    setPhotos(current => [...(current || []), ...newPhotos])
  }

  const addOuting = (outing: Outing) => {
    setOutings(current => [outing, ...(current || [])])
    triggerSync()
  }

  const updateOuting = (outingId: string, updates: Partial<Outing>) => {
    setOutings(current =>
      (current || []).map(o => (o.id === outingId ? { ...o, ...updates } : o))
    )
    triggerSync()
  }

  const deleteOuting = (outingId: string) => {
    setOutings(current => (current || []).filter(o => o.id !== outingId))
    setObservations(current => (current || []).filter(obs => obs.outingId !== outingId))
    setPhotos(current => (current || []).filter(p => p.outingId !== outingId))
    triggerSync()
  }

  const addObservations = (newObservations: Observation[]) => {
    setObservations(current => [...(current || []), ...newObservations])
  }

  const updateObservation = (observationId: string, updates: Partial<Observation>) => {
    setObservations(current =>
      (current || []).map(obs => (obs.id === observationId ? { ...obs, ...updates } : obs))
    )
  }

  const updateLifeList = (outingId: string, confirmedObservations: Observation[]) => {
    const outing = (outings || []).find(o => o.id === outingId)
    if (!outing) return

    setLifeList(current => {
      const updated = new Map((current || []).map(entry => [entry.speciesName, entry]))

      confirmedObservations
        .filter(obs => obs.certainty === 'confirmed')
        .forEach(obs => {
          const existing = updated.get(obs.speciesName)
          const outingDate = new Date(outing.startTime)

          if (existing) {
            const firstDate = new Date(existing.firstSeenDate)
            const lastDate = new Date(existing.lastSeenDate)

            updated.set(obs.speciesName, {
              ...existing,
              firstSeenDate:
                outingDate < firstDate
                  ? outing.startTime
                  : existing.firstSeenDate,
              lastSeenDate:
                outingDate > lastDate ? outing.startTime : existing.lastSeenDate,
              totalOutings: existing.totalOutings + 1,
              totalCount: existing.totalCount + obs.count,
              bestPhotoId: obs.representativePhotoId || existing.bestPhotoId
            })
          } else {
            updated.set(obs.speciesName, {
              speciesName: obs.speciesName,
              firstSeenDate: outing.startTime,
              lastSeenDate: outing.startTime,
              totalOutings: 1,
              totalCount: obs.count,
              bestPhotoId: obs.representativePhotoId,
              notes: ''
            })
          }
        })

      return Array.from(updated.values()).sort((a, b) =>
        a.speciesName.localeCompare(b.speciesName)
      )
    })
  }

  const addSavedSpot = (spot: SavedSpot) => {
    setSavedSpots(current => [...(current || []), spot])
  }

  const deleteSavedSpot = (spotId: string) => {
    setSavedSpots(current => (current || []).filter(s => s.id !== spotId))
  }

  const getOutingObservations = (outingId: string) => {
    return (observations || []).filter(obs => obs.outingId === outingId)
  }

  const getOutingPhotos = (outingId: string) => {
    return (photos || []).filter(p => p.outingId === outingId)
  }

  const getLifeListEntry = (speciesName: string) => {
    return (lifeList || []).find(entry => entry.speciesName === speciesName)
  }

  const importLifeListEntries = (entries: LifeListEntry[]) => {
    setLifeList(current => {
      const updated = new Map((current || []).map(entry => [entry.speciesName, entry]))

      entries.forEach(entry => {
        const existing = updated.get(entry.speciesName)

        if (existing) {
          const existingFirst = new Date(existing.firstSeenDate)
          const existingLast = new Date(existing.lastSeenDate)
          const entryFirst = new Date(entry.firstSeenDate)
          const entryLast = new Date(entry.lastSeenDate)

          updated.set(entry.speciesName, {
            ...existing,
            firstSeenDate:
              entryFirst < existingFirst
                ? entry.firstSeenDate
                : existing.firstSeenDate,
            lastSeenDate:
              entryLast > existingLast ? entry.lastSeenDate : existing.lastSeenDate,
            totalOutings: existing.totalOutings + entry.totalOutings,
            totalCount: existing.totalCount + entry.totalCount
          })
        } else {
          updated.set(entry.speciesName, entry)
        }
      })

      return Array.from(updated.values()).sort((a, b) =>
        a.speciesName.localeCompare(b.speciesName)
      )
    })
  }

  return {
    photos: photos || [],
    outings: outings || [],
    observations: observations || [],
    lifeList: lifeList || [],
    savedSpots: savedSpots || [],
    syncTrigger: syncTrigger || 0,
    addPhotos,
    addOuting,
    updateOuting,
    deleteOuting,
    addObservations,
    updateObservation,
    updateLifeList,
    addSavedSpot,
    deleteSavedSpot,
    getOutingObservations,
    getOutingPhotos,
    getLifeListEntry,
    importLifeListEntries
  }
}
