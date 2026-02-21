import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Photo, Outing, Observation, DexEntry } from '@/lib/types'
import { getUserStorageKey } from '@/lib/storage-keys'
import { fetchWithLocalAuthRetry } from '@/lib/local-auth-fetch'

export type WingDexDataStore = ReturnType<typeof useWingDexData>

type WingDexPayload = {
  outings: Outing[]
  photos: Photo[]
  observations: Observation[]
  dex: DexEntry[]
}

type StorageMode = 'api' | 'local'

function rebuildDexFromState(
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

export const buildDexFromState = rebuildDexFromState

function readLocalData(userId: string): WingDexPayload {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { outings: [], photos: [], observations: [], dex: [] }
  }

  const read = <T>(suffix: 'outings' | 'photos' | 'observations' | 'dex'): T[] => {
    const key = getUserStorageKey(userId, suffix)
    const raw = window.localStorage.getItem(key)
    if (!raw) return []

    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as T[]) : []
    } catch {
      return []
    }
  }

  return {
    outings: read<Outing>('outings'),
    photos: read<Photo>('photos'),
    observations: read<Observation>('observations'),
    dex: read<DexEntry>('dex'),
  }
}

function writeLocalData(userId: string, payload: WingDexPayload) {
  if (typeof window === 'undefined' || !window.localStorage) return

  window.localStorage.setItem(getUserStorageKey(userId, 'outings'), JSON.stringify(payload.outings))
  window.localStorage.setItem(getUserStorageKey(userId, 'photos'), JSON.stringify(payload.photos))
  window.localStorage.setItem(getUserStorageKey(userId, 'observations'), JSON.stringify(payload.observations))
  window.localStorage.setItem(getUserStorageKey(userId, 'dex'), JSON.stringify(payload.dex))
}

async function apiJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetchWithLocalAuthRetry(input, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  })

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`)
  }

  return response.json() as Promise<T>
}

export function useWingDexData(userId: string) {
  const [isLoading, setIsLoading] = useState(true)
  const [storageMode, setStorageMode] = useState<StorageMode>('api')
  const [payload, setPayload] = useState<WingDexPayload>({
    outings: [],
    photos: [],
    observations: [],
    dex: [],
  })

  const payloadRef = useRef(payload)
  useEffect(() => {
    payloadRef.current = payload
  }, [payload])

  const refresh = useCallback(async () => {
    try {
      const next = await apiJson<WingDexPayload>('/api/data/all')
      setStorageMode('api')
      setPayload({
        outings: next.outings || [],
        photos: next.photos || [],
        observations: next.observations || [],
        dex: next.dex || [],
      })
    } catch {
      setStorageMode('local')
      setPayload(readLocalData(userId))
    }
  }, [userId])

  useEffect(() => {
    let cancelled = false

    setIsLoading(true)
    void refresh().finally(() => {
      if (!cancelled) {
        setIsLoading(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [refresh])

  const applyPayload = (next: WingDexPayload) => {
    setPayload(next)
    if (storageMode === 'local') {
      writeLocalData(userId, next)
    }
  }

  const applyDexUpdates = (dexUpdates: DexEntry[] | undefined) => {
    if (!dexUpdates) return
    setPayload(current => {
      const next = { ...current, dex: dexUpdates }
      if (storageMode === 'local') {
        writeLocalData(userId, next)
      }
      return next
    })
  }

  const addPhotos = (newPhotos: Photo[]) => {
    if (newPhotos.length === 0) return

    const optimistic: WingDexPayload = {
      ...payloadRef.current,
      photos: [...payloadRef.current.photos, ...newPhotos],
    }
    applyPayload(optimistic)

    if (storageMode === 'api') {
      void apiJson<Photo[]>('/api/data/photos', {
        method: 'POST',
        body: JSON.stringify(newPhotos),
      }).catch(() => undefined)
    }
  }

  const addOuting = (outing: Outing) => {
    const optimistic: WingDexPayload = {
      ...payloadRef.current,
      outings: [outing, ...payloadRef.current.outings],
    }
    applyPayload(optimistic)

    if (storageMode === 'api') {
      void apiJson<Outing>('/api/data/outings', {
        method: 'POST',
        body: JSON.stringify(outing),
      })
        .then(savedOuting => {
          setPayload(current => {
            const next = {
              ...current,
              outings: current.outings.map(item => (item.id === savedOuting.id ? savedOuting : item)),
            }
            return next
          })
        })
        .catch(() => undefined)
    }
  }

  const updateOuting = (outingId: string, updates: Partial<Outing>) => {
    const optimistic: WingDexPayload = {
      ...payloadRef.current,
      outings: payloadRef.current.outings.map(outing =>
        outing.id === outingId ? { ...outing, ...updates } : outing
      ),
    }
    applyPayload(optimistic)

    if (storageMode === 'api') {
      void apiJson<Outing>(`/api/data/outings/${outingId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      })
        .then(savedOuting => {
          setPayload(current => ({
            ...current,
            outings: current.outings.map(outing => (outing.id === outingId ? savedOuting : outing)),
          }))
        })
        .catch(() => undefined)
    }
  }

  const deleteOuting = (outingId: string) => {
    const remainingOutings = payloadRef.current.outings.filter(outing => outing.id !== outingId)
    const remainingObservations = payloadRef.current.observations.filter(
      observation => observation.outingId !== outingId
    )
    const remainingPhotos = payloadRef.current.photos.filter(photo => photo.outingId !== outingId)
    const optimistic: WingDexPayload = {
      outings: remainingOutings,
      photos: remainingPhotos,
      observations: remainingObservations,
      dex: rebuildDexFromState(remainingOutings, remainingObservations, payloadRef.current.dex),
    }

    applyPayload(optimistic)

    if (storageMode === 'api') {
      void apiJson<{ dexUpdates: DexEntry[] }>(`/api/data/outings/${outingId}`, { method: 'DELETE' })
        .then(response => applyDexUpdates(response.dexUpdates))
        .catch(() => undefined)
    }
  }

  const addObservations = (newObservations: Observation[]) => {
    if (newObservations.length === 0) return

    const optimistic: WingDexPayload = {
      ...payloadRef.current,
      observations: [...payloadRef.current.observations, ...newObservations],
    }
    applyPayload(optimistic)

    if (storageMode === 'api') {
      void apiJson<{ observations: Observation[]; dexUpdates: DexEntry[] }>('/api/data/observations', {
        method: 'POST',
        body: JSON.stringify(newObservations),
      })
        .then(response => {
          setPayload(current => {
            const byId = new Map(current.observations.map(observation => [observation.id, observation]))
            for (const observation of response.observations || []) {
              byId.set(observation.id, observation)
            }

            const next = {
              ...current,
              observations: Array.from(byId.values()),
              dex: response.dexUpdates || current.dex,
            }
            return next
          })
        })
        .catch(() => undefined)
    }
  }

  const updateObservation = (observationId: string, updates: Partial<Observation>) => {
    const optimistic: WingDexPayload = {
      ...payloadRef.current,
      observations: payloadRef.current.observations.map(observation =>
        observation.id === observationId ? { ...observation, ...updates } : observation
      ),
    }

    if (storageMode === 'local') {
      optimistic.dex = rebuildDexFromState(optimistic.outings, optimistic.observations, optimistic.dex)
    }

    applyPayload(optimistic)

    if (storageMode === 'api') {
      void apiJson<{ observation?: Observation; dexUpdates: DexEntry[] }>('/api/data/observations', {
        method: 'PATCH',
        body: JSON.stringify({ id: observationId, ...updates }),
      })
        .then(response => {
          setPayload(current => {
            const nextObservations = response.observation
              ? current.observations.map(observation =>
                  observation.id === observationId ? response.observation as Observation : observation
                )
              : current.observations

            return {
              ...current,
              observations: nextObservations,
              dex: response.dexUpdates || current.dex,
            }
          })
        })
        .catch(() => undefined)
    }
  }

  const bulkUpdateObservations = (ids: string[], updates: Partial<Observation>) => {
    if (ids.length === 0) return

    const idSet = new Set(ids)
    const optimistic: WingDexPayload = {
      ...payloadRef.current,
      observations: payloadRef.current.observations.map(observation =>
        idSet.has(observation.id) ? { ...observation, ...updates } : observation
      ),
    }

    if (storageMode === 'local') {
      optimistic.dex = rebuildDexFromState(optimistic.outings, optimistic.observations, optimistic.dex)
    }

    applyPayload(optimistic)

    if (storageMode === 'api') {
      void apiJson<{ observations?: Observation[]; dexUpdates: DexEntry[] }>('/api/data/observations', {
        method: 'PATCH',
        body: JSON.stringify({ ids, patch: updates }),
      })
        .then(response => {
          setPayload(current => {
            const updatesById = new Map((response.observations || []).map(observation => [observation.id, observation]))
            const nextObservations = current.observations.map(observation => updatesById.get(observation.id) || observation)

            return {
              ...current,
              observations: nextObservations,
              dex: response.dexUpdates || current.dex,
            }
          })
        })
        .catch(() => undefined)
    }
  }

  const updateDex = (
    outingId: string,
    confirmedObservations: Observation[]
  ): { newSpeciesCount: number } => {
    const outing = payloadRef.current.outings.find(currentOuting => currentOuting.id === outingId)
    if (!outing) return { newSpeciesCount: 0 }

    const incomingConfirmed = confirmedObservations.filter(
      obs => obs.certainty === 'confirmed'
    )
    if (incomingConfirmed.length === 0) return { newSpeciesCount: 0 }

    const existingSpecies = new Set(payloadRef.current.dex.map(entry => entry.speciesName))
    const incomingSpecies = new Set(incomingConfirmed.map(obs => obs.speciesName))
    const newSpeciesCount = Array.from(incomingSpecies).filter(
      speciesName => !existingSpecies.has(speciesName)
    ).length

    if (storageMode === 'local') {
      const uniqueCombined = new Map<string, Observation>()
      for (const observation of payloadRef.current.observations) {
        uniqueCombined.set(observation.id, observation)
      }
      for (const observation of incomingConfirmed) {
        uniqueCombined.set(observation.id, observation)
      }

      const combinedConfirmed = Array.from(uniqueCombined.values()).filter(
        observation => observation.certainty === 'confirmed'
      )
      const recomputedDex = rebuildDexFromState(payloadRef.current.outings, combinedConfirmed, payloadRef.current.dex)
      applyPayload({
        ...payloadRef.current,
        dex: recomputedDex,
      })
    }

    return { newSpeciesCount }
  }

  const getOutingObservations = (outingId: string) => {
    return payload.observations.filter(observation => observation.outingId === outingId)
  }

  const getOutingPhotos = (outingId: string) => {
    return payload.photos.filter(photo => photo.outingId === outingId)
  }

  const getDexEntry = (speciesName: string) => {
    return payload.dex.find(entry => entry.speciesName === speciesName)
  }

  const importDexEntries = (entries: DexEntry[]) => {
    const updated = new Map(payloadRef.current.dex.map(entry => [entry.speciesName, entry]))

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

    const optimisticDex = Array.from(updated.values()).sort((a, b) =>
      a.speciesName.localeCompare(b.speciesName)
    )
    applyPayload({
      ...payloadRef.current,
      dex: optimisticDex,
    })

    if (storageMode === 'api') {
      const patches = entries.map(entry => ({
        speciesName: entry.speciesName,
        addedDate: entry.addedDate,
        bestPhotoId: entry.bestPhotoId,
        notes: entry.notes,
      }))

      void apiJson<{ dexUpdates: DexEntry[] }>('/api/data/dex', {
        method: 'PATCH',
        body: JSON.stringify(patches),
      })
        .then(response => applyDexUpdates(response.dexUpdates))
        .catch(() => undefined)
    }
  }

  /** Import outings, observations, and update dex in one shot (for eBird CSV import) */
  const importFromEBird = (
    newOutings: Outing[],
    newObservations: Observation[]
  ): { newSpeciesCount: number } => {
    const existingSpecies = new Set(payloadRef.current.dex.map(entry => entry.speciesName))
    const incomingSpecies = new Set(
      newObservations
        .filter(observation => observation.certainty === 'confirmed')
        .map(observation => observation.speciesName)
    )
    const newSpeciesCount = Array.from(incomingSpecies).filter(speciesName => !existingSpecies.has(speciesName)).length

    const optimistic: WingDexPayload = {
      ...payloadRef.current,
      outings: [...newOutings, ...payloadRef.current.outings],
      observations: [...payloadRef.current.observations, ...newObservations],
      dex: rebuildDexFromState(
        [...newOutings, ...payloadRef.current.outings],
        [...payloadRef.current.observations, ...newObservations],
        payloadRef.current.dex,
      ),
    }
    applyPayload(optimistic)

    if (storageMode === 'api') {
      void Promise.all(
        newOutings.map(outing =>
          apiJson('/api/data/outings', {
            method: 'POST',
            body: JSON.stringify(outing),
          })
        )
      )
        .then(() =>
          apiJson<{ observations: Observation[]; dexUpdates: DexEntry[] }>('/api/data/observations', {
            method: 'POST',
            body: JSON.stringify(newObservations),
          })
        )
        .then(response => applyDexUpdates(response.dexUpdates))
        .catch(() => undefined)
    }

    return { newSpeciesCount }
  }

  const clearAllData = () => {
    const next: WingDexPayload = {
      outings: [],
      photos: [],
      observations: [],
      dex: [],
    }
    applyPayload(next)

    if (storageMode === 'api') {
      void apiJson<{ cleared: boolean }>('/api/data/clear', { method: 'DELETE' }).catch(() => undefined)
    }

    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const legacySavedSpotsKey = getUserStorageKey(userId, 'savedSpots')
        window.localStorage.removeItem(legacySavedSpotsKey)
      } catch {
        // Ignore storage errors; primary data has already been cleared
      }
    }
  }

  const loadSeedData = (
    seedOutings: Outing[],
    seedObservations: Observation[],
    seedDex: DexEntry[],
  ) => {
    const next = {
      outings: seedOutings,
      photos: payloadRef.current.photos,
      observations: seedObservations,
      dex: seedDex,
    }
    applyPayload(next)

    if (storageMode === 'api') {
      void apiJson<{ dexUpdates?: DexEntry[] }>('/api/data/seed', {
        method: 'POST',
        body: JSON.stringify({
          outings: seedOutings,
          observations: seedObservations,
          dex: seedDex,
        }),
      })
        .then(response => {
          if (response.dexUpdates) {
            applyDexUpdates(response.dexUpdates)
          }
        })
        .catch(() => undefined)
    }
  }

  const store = useMemo(() => ({
    isLoading,
    photos: payload.photos,
    outings: payload.outings,
    observations: payload.observations,
    dex: payload.dex,
    addPhotos,
    addOuting,
    updateOuting,
    deleteOuting,
    addObservations,
    updateObservation,
    bulkUpdateObservations,
    updateDex,
    getOutingObservations,
    getOutingPhotos,
    getDexEntry,
    importDexEntries,
    importFromEBird,
    clearAllData,
    loadSeedData,
    refresh,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation fns close over refs, not state; intentionally omitted
  }), [isLoading, payload, refresh])

  return store
}
