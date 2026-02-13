import { useKV } from '@/hooks/use-kv'
import type { Photo, Outing, Observation, DexEntry, SavedSpot } from '@/lib/types'

export type BirdDexDataStore = ReturnType<typeof useBirdDexData>

export function useBirdDexData(userId: number) {
  const prefix = `u${userId}_`
  const [photos, setPhotos] = useKV<Photo[]>(`${prefix}photos`, [])
  const [outings, setOutings] = useKV<Outing[]>(`${prefix}outings`, [])
  const [observations, setObservations] = useKV<Observation[]>(`${prefix}observations`, [])
  const [dex, setDex] = useKV<DexEntry[]>(`${prefix}dex`, [])
  const [savedSpots, setSavedSpots] = useKV<SavedSpot[]>(`${prefix}savedSpots`, [])

  const addPhotos = (newPhotos: Photo[]) => {
    setPhotos(current => [...(current || []), ...newPhotos])
  }

  const addOuting = (outing: Outing) => {
    setOutings(current => [outing, ...(current || [])])
  }

  const updateOuting = (outingId: string, updates: Partial<Outing>) => {
    setOutings(current =>
      (current || []).map(o => (o.id === outingId ? { ...o, ...updates } : o))
    )
  }

  const deleteOuting = (outingId: string) => {
    setOutings(current => (current || []).filter(o => o.id !== outingId))
    setObservations(current => (current || []).filter(obs => obs.outingId !== outingId))
    setPhotos(current => (current || []).filter(p => p.outingId !== outingId))
  }

  const addObservations = (newObservations: Observation[]) => {
    setObservations(current => [...(current || []), ...newObservations])
  }

  const updateObservation = (observationId: string, updates: Partial<Observation>) => {
    setObservations(current =>
      (current || []).map(obs => (obs.id === observationId ? { ...obs, ...updates } : obs))
    )
  }

  const updateDex = (outingId: string, confirmedObservations: Observation[]) => {
    const outing = (outings || []).find(o => o.id === outingId)
    if (!outing) return

    setDex(current => {
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
              addedDate: new Date().toISOString(),
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

  const getDexEntry = (speciesName: string) => {
    return (dex || []).find(entry => entry.speciesName === speciesName)
  }

  const importDexEntries = (entries: DexEntry[]) => {
    setDex(current => {
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

  /** Import outings, observations, and update dex in one shot (for eBird CSV import) */
  const importFromEBird = (
    newOutings: Outing[],
    newObservations: Observation[]
  ): { newSpeciesCount: number } => {
    // Add outings
    setOutings(current => [...newOutings, ...(current || [])])
    // Add observations
    setObservations(current => [...(current || []), ...newObservations])

    // Update dex
    let newSpeciesCount = 0
    setDex(current => {
      const updated = new Map((current || []).map(entry => [entry.speciesName, entry]))

      for (const outing of newOutings) {
        const outingObs = newObservations.filter(
          obs => obs.outingId === outing.id && obs.certainty === 'confirmed'
        )
        for (const obs of outingObs) {
          const existing = updated.get(obs.speciesName)
          const outingDate = new Date(outing.startTime)

          if (existing) {
            const firstDate = new Date(existing.firstSeenDate)
            const lastDate = new Date(existing.lastSeenDate)
            updated.set(obs.speciesName, {
              ...existing,
              firstSeenDate:
                outingDate < firstDate ? outing.startTime : existing.firstSeenDate,
              lastSeenDate:
                outingDate > lastDate ? outing.startTime : existing.lastSeenDate,
              totalOutings: existing.totalOutings + 1,
              totalCount: existing.totalCount + obs.count,
            })
          } else {
            newSpeciesCount++
            updated.set(obs.speciesName, {
              speciesName: obs.speciesName,
              firstSeenDate: outing.startTime,
              lastSeenDate: outing.startTime,
              addedDate: new Date().toISOString(),
              totalOutings: 1,
              totalCount: obs.count,
              notes: '',
            })
          }
        }
      }

      return Array.from(updated.values()).sort((a, b) =>
        a.speciesName.localeCompare(b.speciesName)
      )
    })

    return { newSpeciesCount }
  }

  const clearAllData = () => {
    setPhotos([])
    setOutings([])
    setObservations([])
    setDex([])
    setSavedSpots([])
  }

  const loadSeedData = (
    seedOutings: Outing[],
    seedObservations: Observation[],
    seedDex: DexEntry[],
  ) => {
    setOutings(seedOutings)
    setObservations(seedObservations)
    setDex(seedDex)
  }

  return {
    photos: photos || [],
    outings: outings || [],
    observations: observations || [],
    dex: dex || [],
    savedSpots: savedSpots || [],
    addPhotos,
    addOuting,
    updateOuting,
    deleteOuting,
    addObservations,
    updateObservation,
    updateDex,
    addSavedSpot,
    deleteSavedSpot,
    getOutingObservations,
    getOutingPhotos,
    getDexEntry,
    importDexEntries,
    importFromEBird,
    clearAllData,
    loadSeedData,
  }
}
