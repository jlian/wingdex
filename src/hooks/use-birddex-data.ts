import { useKV } from '@/hooks/use-kv'
import type { Photo, Outing, Observation, DexEntry, SavedSpot } from '@/lib/types'
import { getUserStorageKey } from '@/lib/storage-keys'

export type BirdDexDataStore = ReturnType<typeof useBirdDexData>

export function buildDexFromState(
  allOutings: Outing[],
  allObservations: Observation[],
  existingDex: DexEntry[]
): DexEntry[] {
  const outingsById = new Map(allOutings.map(outing => [outing.id, outing]))
  const existingBySpecies = new Map(existingDex.map(entry => [entry.speciesName, entry]))
  const grouped = new Map<string, Observation[]>()

  for (const observation of allObservations) {
    if (observation.certainty !== 'confirmed') continue
    const list = grouped.get(observation.speciesName)
    if (list) {
      list.push(observation)
    } else {
      grouped.set(observation.speciesName, [observation])
    }
  }

  const rebuilt: DexEntry[] = []

  for (const [speciesName, speciesObservations] of grouped.entries()) {
    const speciesOutings = speciesObservations
      .map(observation => outingsById.get(observation.outingId))
      .filter((outing): outing is Outing => !!outing)

    if (speciesOutings.length === 0) continue

    const firstSeen = speciesOutings.reduce((min, currentOuting) =>
      new Date(currentOuting.startTime) < new Date(min.startTime)
        ? currentOuting
        : min
    )
    const lastSeen = speciesOutings.reduce((max, currentOuting) =>
      new Date(currentOuting.startTime) > new Date(max.startTime)
        ? currentOuting
        : max
    )

    const totalCount = speciesObservations.reduce((sum, observation) => sum + observation.count, 0)
    const totalOutings = new Set(speciesObservations.map(observation => observation.outingId)).size
    const existing = existingBySpecies.get(speciesName)
    const latestWithPhoto = [...speciesObservations].reverse().find(observation => observation.representativePhotoId)

    rebuilt.push({
      speciesName,
      firstSeenDate: firstSeen.startTime,
      lastSeenDate: lastSeen.startTime,
      addedDate: existing?.addedDate || new Date().toISOString(),
      totalOutings,
      totalCount,
      bestPhotoId: latestWithPhoto?.representativePhotoId || existing?.bestPhotoId,
      notes: existing?.notes || '',
    })
  }

  return rebuilt.sort((a, b) => a.speciesName.localeCompare(b.speciesName))
}

export function useBirdDexData(userId: number) {
  const [photos, setPhotos] = useKV<Photo[]>(getUserStorageKey(userId, 'photos'), [])
  const [outings, setOutings] = useKV<Outing[]>(getUserStorageKey(userId, 'outings'), [])
  const [observations, setObservations] = useKV<Observation[]>(getUserStorageKey(userId, 'observations'), [])
  const [dex, setDex] = useKV<DexEntry[]>(getUserStorageKey(userId, 'dex'), [])
  const [savedSpots, setSavedSpots] = useKV<SavedSpot[]>(getUserStorageKey(userId, 'savedSpots'), [])

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
    setOutings(currentOutings => {
      const remainingOutings = (currentOutings || []).filter(outing => outing.id !== outingId)
      setObservations(currentObservations => {
        const remainingObservations = (currentObservations || []).filter(
          observation => observation.outingId !== outingId
        )
        setDex(currentDex => buildDexFromState(remainingOutings, remainingObservations, currentDex || []))
        return remainingObservations
      })
      return remainingOutings
    })
    setPhotos(current => (current || []).filter(p => p.outingId !== outingId))
  }

  const addObservations = (newObservations: Observation[]) => {
    setObservations(current => [...(current || []), ...newObservations])
  }

  const updateObservation = (observationId: string, updates: Partial<Observation>) => {
    setObservations(currentObservations => {
      const updatedObservations = (currentObservations || []).map(observation =>
        observation.id === observationId ? { ...observation, ...updates } : observation
      )
      setDex(currentDex => buildDexFromState(outings || [], updatedObservations, currentDex || []))
      return updatedObservations
    })
  }

  const updateDex = (
    outingId: string,
    confirmedObservations: Observation[]
  ): { newSpeciesCount: number } => {
    const outing = (outings || []).find(o => o.id === outingId)
    if (!outing) return { newSpeciesCount: 0 }

    const incomingConfirmed = confirmedObservations.filter(
      obs => obs.certainty === 'confirmed'
    )
    if (incomingConfirmed.length === 0) return { newSpeciesCount: 0 }

    const existingSpecies = new Set((dex || []).map(entry => entry.speciesName))
    const incomingSpecies = new Set(incomingConfirmed.map(obs => obs.speciesName))
    const newSpeciesCount = Array.from(incomingSpecies).filter(
      speciesName => !existingSpecies.has(speciesName)
    ).length

    const uniqueCombined = new Map<string, Observation>()
    for (const obs of observations || []) {
      uniqueCombined.set(obs.id, obs)
    }
    for (const obs of incomingConfirmed) {
      uniqueCombined.set(obs.id, obs)
    }

    const combinedConfirmed = Array.from(uniqueCombined.values()).filter(
      obs => obs.certainty === 'confirmed'
    )

    const outingById = new Map((outings || []).map(o => [o.id, o]))
    outingById.set(outing.id, outing)

    setDex(current => {
      const updated = new Map((current || []).map(entry => [entry.speciesName, entry]))

      for (const speciesName of incomingSpecies) {
        const speciesObservations = combinedConfirmed.filter(
          obs => obs.speciesName === speciesName
        )
        const speciesOutings = speciesObservations
          .map(obs => outingById.get(obs.outingId))
          .filter((o): o is Outing => !!o)

        if (speciesOutings.length === 0) continue

        const firstSeen = speciesOutings.reduce((min, currentOuting) =>
          new Date(currentOuting.startTime) < new Date(min.startTime)
            ? currentOuting
            : min
        )
        const lastSeen = speciesOutings.reduce((max, currentOuting) =>
          new Date(currentOuting.startTime) > new Date(max.startTime)
            ? currentOuting
            : max
        )

        const totalCount = speciesObservations.reduce((sum, obs) => sum + obs.count, 0)
        const totalOutings = new Set(speciesObservations.map(obs => obs.outingId)).size

        const existing = updated.get(speciesName)
        const latestIncomingForSpecies = incomingConfirmed.find(
          obs => obs.speciesName === speciesName
        )

        updated.set(speciesName, {
          speciesName,
          firstSeenDate: firstSeen.startTime,
          lastSeenDate: lastSeen.startTime,
          addedDate: existing?.addedDate || new Date().toISOString(),
          totalOutings,
          totalCount,
          bestPhotoId: latestIncomingForSpecies?.representativePhotoId || existing?.bestPhotoId,
          notes: existing?.notes || '',
        })
      }

      return Array.from(updated.values()).sort((a, b) =>
        a.speciesName.localeCompare(b.speciesName)
      )
    })

    return { newSpeciesCount }
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
    newObservations: Observation[],
    newSavedSpots?: SavedSpot[]
  ): { newSpeciesCount: number } => {
    // Add any extracted saved spots
    if (newSavedSpots && newSavedSpots.length > 0) {
      setSavedSpots(current => [...(current || []), ...newSavedSpots])
    }
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
