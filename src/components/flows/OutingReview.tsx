import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { OutingNameAutocomplete } from '@/components/ui/outing-name-autocomplete'
import { CalendarBlank, CheckCircle, XCircle, PencilSimple, MagnifyingGlass } from '@phosphor-icons/react'
import { Switch } from '@/components/ui/switch'
import { findMatchingOuting } from '@/lib/clustering'
import { dateToLocalISOWithOffset, toLocalISOWithOffset, formatStoredDate, formatStoredTimeWithTZ } from '@/lib/timezone'
import type { WingDexDataStore } from '@/hooks/use-wingdex-data'
import { toast } from 'sonner'

interface PhotoCluster {
  photos: any[]
  startTime: Date
  endTime: Date
  centerLat?: number
  centerLon?: number
}

interface OutingReviewProps {
  cluster: PhotoCluster
  data: WingDexDataStore
  userId: number
  /** Pre-fill location from a previous outing (user can override) */
  defaultLocationName?: string
  /** Automatically look up location name from GPS when available */
  autoLookupGps?: boolean
  onConfirm: (
    outingId: string,
    locationName: string,
    lat?: number,
    lon?: number
  ) => void
}

export default function OutingReview({
  cluster,
  data,
  userId,
  defaultLocationName = '',
  autoLookupGps = false,
  onConfirm
}: OutingReviewProps) {
  const hasGps = cluster.centerLat !== undefined && cluster.centerLon !== undefined
  const [locationName, setLocationName] = useState(defaultLocationName)
  const [isLoadingLocation, setIsLoadingLocation] = useState(false)
  const [suggestedLocation, setSuggestedLocation] = useState(defaultLocationName)

  // Compute observation-local ISO string for display and manual editing.
  // cluster.startTime is a UTC-correct Date (exifTime is offset-aware),
  // so dateToLocalISOWithOffset formats it in the photo's GPS timezone.
  const startLocalISO = dateToLocalISOWithOffset(cluster.startTime, cluster.centerLat, cluster.centerLon)
  const startLocalMatch = startLocalISO.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)

  // Manual date/time editing (#13)
  const [editingDateTime, setEditingDateTime] = useState(false)
  const [manualDate, setManualDate] = useState(
    startLocalMatch ? startLocalMatch[1] : cluster.startTime.toISOString().slice(0, 10)
  )
  const [manualTime, setManualTime] = useState(
    startLocalMatch ? startLocalMatch[2] : '00:00'
  )
  const [overriddenStartTime, setOverriddenStartTime] = useState<Date | null>(null)

  // Place search (#13)
  const [placeQuery, setPlaceQuery] = useState('')
  const [placeResults, setPlaceResults] = useState<Array<{ display_name: string; lat: string; lon: string }>>([])
  const [isSearchingPlace, setIsSearchingPlace] = useState(false)
  const [overriddenCoords, setOverriddenCoords] = useState<{ lat: number; lon: number } | null>(null)

  // Effective coordinates (manual override or cluster GPS)
  const effectiveLat = overriddenCoords?.lat ?? cluster.centerLat
  const effectiveLon = overriddenCoords?.lon ?? cluster.centerLon
  const effectiveStartTime = overriddenStartTime ?? cluster.startTime
  const effectiveEndTime = overriddenStartTime
    ? new Date(overriddenStartTime.getTime() + (cluster.endTime.getTime() - cluster.startTime.getTime()))
    : cluster.endTime

  // Check if these photos match an existing outing
  const matchingOuting = findMatchingOuting(cluster, data.outings)
  const [useExistingOuting, setUseExistingOuting] = useState(!!matchingOuting)

  // Automatically look up location name from GPS when enabled
  useEffect(() => {
    if (autoLookupGps && hasGps && !matchingOuting) {
      const roundedLat = Number(cluster.centerLat!.toFixed(3))
      const roundedLon = Number(cluster.centerLon!.toFixed(3))
      void fetchLocationName(roundedLat, roundedLon)
    }
  }, [cluster.startTime, cluster.endTime]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchLocationName = async (lat: number, lon: number) => {
    setIsLoadingLocation(true)
    try {
      // Prefer Nominatim-native place hierarchy:
      // 1) nearby major nature POI from bounded search (park/reserve/refuge/etc.)
      // 2) natural feature at point (strait/bay/lake/cliff/etc.)
      // 3) neighborhood-level reverse geocode
      // 4) city-level reverse geocode
      console.log('📍 Reverse geocoding via Nominatim...')

      const scoreResult = (result: any): number => {
        if (!result) return 0
        const category = String(result.category || '').toLowerCase()
        const type = String(result.type || '').toLowerCase()
        const address = result.address || {}
        const hasName = Boolean(result.name || result.namedetails?.['name:en'] || result.namedetails?.name)

        let score = 0
        if (category === 'leisure' && type === 'park') score += 100
        else if (category === 'boundary' && type === 'protected_area') score += 95
        else if (category === 'natural') score += 80
        else if (category === 'waterway') score += 72
        else if (category === 'place' && ['suburb', 'neighbourhood', 'village', 'town'].includes(type)) score += 60
        else if (category === 'boundary' && type === 'administrative') score += 45

        if (hasName) score += 5
        if (address.city || address.town || address.village || address.county) score += 5
        return Math.min(score, 100)
      }

      const fetchNearbyNaturePlace = async (): Promise<any | null> => {
        const deltas = [0.02]
        const queries = ['park']
        const EARLY_EXIT_SCORE = 90
        let best: any | null = null
        let bestScore = 0

        for (const delta of deltas) {
          const left = (lon - delta).toFixed(6)
          const right = (lon + delta).toFixed(6)
          const top = (lat + delta).toFixed(6)
          const bottom = (lat - delta).toFixed(6)

          for (const q of queries) {
            const url = new URL('https://nominatim.openstreetmap.org/search')
            url.searchParams.set('format', 'jsonv2')
            url.searchParams.set('q', q)
            url.searchParams.set('addressdetails', '1')
            url.searchParams.set('namedetails', '1')
            url.searchParams.set('accept-language', 'en')
            url.searchParams.set('bounded', '1')
            url.searchParams.set('limit', '5')
            url.searchParams.set('viewbox', `${left},${top},${right},${bottom}`)

            const res = await fetch(url.toString())
            if (!res.ok) throw new Error(`Nominatim ${res.status}`)

            const results = await res.json()
            if (!Array.isArray(results) || results.length === 0) continue

            for (const item of results) {
              const itemScore = scoreResult(item)
              if (itemScore > bestScore) {
                best = item
                bestScore = itemScore
              }
              if (itemScore >= EARLY_EXIT_SCORE) return item
            }
          }
        }

        return best
      }

      const fetchReverse = async (params: Record<string, string>): Promise<any | null> => {
        const url = new URL('https://nominatim.openstreetmap.org/reverse')
        url.searchParams.set('lat', String(lat))
        url.searchParams.set('lon', String(lon))
        url.searchParams.set('format', 'jsonv2')
        url.searchParams.set('addressdetails', '1')
        url.searchParams.set('namedetails', '1')
        url.searchParams.set('accept-language', 'en')
        Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))

        const res = await fetch(url.toString())
        if (!res.ok) throw new Error(`Nominatim ${res.status}`)
        return res.json()
      }

      const formatLabel = (result: any): string => {
        if (!result) return ''
        const englishName =
          result.namedetails?.['name:en'] ||
          result.namedetails?.name
        const address = result.address || {}
        const primary =
          englishName ||
          result.name ||
          address.park ||
          address.nature_reserve ||
          address.recreation_ground ||
          address.leisure ||
          address.tourism ||
          address.amenity ||
          address.neighbourhood ||
          address.suburb ||
          address.village ||
          address.town ||
          address.city ||
          address.county ||
          address.state

        const locality =
          address.neighbourhood ||
          address.suburb ||
          address.village ||
          address.town ||
          address.city ||
          address.county

        const parts = [primary, locality, address.state]
          .filter((v, idx, arr) => !!v && arr.indexOf(v) === idx)
          .slice(0, 3)

        return parts.join(', ')
      }

      const naturePoiResult = await fetchNearbyNaturePlace()
      const naturePoiScore = scoreResult(naturePoiResult)
      let name = naturePoiScore >= 60 ? formatLabel(naturePoiResult) : ''

      if (!name) {
        const naturalResult = await fetchReverse({ layer: 'natural', zoom: '15' })
        const naturalScore = scoreResult(naturalResult)
        if (naturalScore >= 60) {
          name = formatLabel(naturalResult)
        }
      }

      if (!name) {
        const neighborhoodResult = await fetchReverse({ layer: 'address', zoom: '14' })
        name = formatLabel(neighborhoodResult)
      }

      if (!name) {
        const cityResult = await fetchReverse({ layer: 'address', zoom: '10' })
        name = formatLabel(cityResult)
      }

      if (!name) throw new Error('No location name returned')
      
      console.log('✅ Location identified:', name)
      setSuggestedLocation(name)
      setLocationName(name)
    } catch (error) {
      console.error('❌ Reverse geocoding failed:', error)
      toast.warning('Could not look up location name — using coordinates instead')
      // Fall back to default location or coordinate string
      const fallback = defaultLocationName || `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`
      console.log('⚠️ Using fallback:', fallback)
      setSuggestedLocation(fallback)
      setLocationName(fallback)
    } finally {
      setIsLoadingLocation(false)
    }
  }

  const doConfirm = (name: string) => {
    if (useExistingOuting && matchingOuting) {
      // Merge into existing outing — expand its time window if needed.
      // cluster.startTime is a proper UTC instant (exifTime is offset-aware),
      // so dateToLocalISOWithOffset correctly formats it in the outing's TZ.
      const clusterStartISO = dateToLocalISOWithOffset(
        cluster.startTime, matchingOuting.lat, matchingOuting.lon
      )
      const clusterEndISO = dateToLocalISOWithOffset(
        cluster.endTime, matchingOuting.lat, matchingOuting.lon
      )
      const existingStartMs = new Date(matchingOuting.startTime).getTime()
      const existingEndMs = new Date(matchingOuting.endTime).getTime()
      const clusterStartMs = cluster.startTime.getTime()
      const clusterEndMs = cluster.endTime.getTime()

      if (clusterStartMs < existingStartMs || clusterEndMs > existingEndMs) {
        data.updateOuting(matchingOuting.id, {
          startTime: clusterStartMs < existingStartMs ? clusterStartISO : matchingOuting.startTime,
          endTime: clusterEndMs > existingEndMs ? clusterEndISO : matchingOuting.endTime,
        })
      }

      onConfirm(matchingOuting.id, matchingOuting.locationName, matchingOuting.lat, matchingOuting.lon)
      return
    }

    const outingId = `outing_${Date.now()}`
    const outing = {
      id: outingId,
      userId: userId.toString(),
      startTime: dateToLocalISOWithOffset(effectiveStartTime, effectiveLat, effectiveLon),
      endTime: dateToLocalISOWithOffset(effectiveEndTime, effectiveLat, effectiveLon),
      locationName: name || 'Unknown Location',
      defaultLocationName: name || 'Unknown Location',
      lat: effectiveLat,
      lon: effectiveLon,
      notes: '',
      createdAt: new Date().toISOString()
    }

    data.addOuting(outing)
    onConfirm(outingId, name || 'Unknown Location', effectiveLat, effectiveLon)
  }

  const handleConfirm = () => doConfirm(locationName)

  const handleApplyDateTime = () => {
    const [year, month, day] = manualDate.split('-').map(Number)
    const [hours, minutes] = manualTime.split(':').map(Number)
    if (!isNaN(year) && !isNaN(month) && !isNaN(day) && !isNaN(hours) && !isNaN(minutes)) {
      // User types observation-local time. Convert to a correct UTC instant
      // by treating it as naive local at the GPS coords.
      const pad = (n: number) => String(n).padStart(2, '0')
      const naiveISO = `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00`
      const offsetAware = toLocalISOWithOffset(naiveISO, effectiveLat, effectiveLon)
      setOverriddenStartTime(new Date(offsetAware))
      setEditingDateTime(false)
    }
  }

  const searchPlace = async () => {
    if (!placeQuery.trim()) return
    setIsSearchingPlace(true)
    try {
      const url = new URL('https://nominatim.openstreetmap.org/search')
      url.searchParams.set('format', 'jsonv2')
      url.searchParams.set('q', placeQuery)
      url.searchParams.set('limit', '5')
      url.searchParams.set('accept-language', 'en')
      const res = await fetch(url.toString())
      if (!res.ok) throw new Error(`Nominatim ${res.status}`)
      const results = await res.json()
      setPlaceResults(results)
    } catch (error) {
      console.error('Place search failed:', error)
      toast.error('Place search failed')
    } finally {
      setIsSearchingPlace(false)
    }
  }

  const selectPlace = (place: { display_name: string; lat: string; lon: string }) => {
    const lat = parseFloat(place.lat)
    const lon = parseFloat(place.lon)
    setOverriddenCoords({ lat, lon })
    // Use the first part of the display name as location name
    const shortName = place.display_name.split(',').slice(0, 3).join(',').trim()
    setLocationName(shortName)
    setSuggestedLocation(shortName)
    setPlaceResults([])
    setPlaceQuery('')
  }


  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {/* Date/time display with edit capability (#13) */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarBlank size={18} />
          {(() => {
            // Format in the observation's timezone (GPS coords), not browser TZ
            const displayISO = dateToLocalISOWithOffset(effectiveStartTime, effectiveLat, effectiveLon)
            return (
              <span>
                {formatStoredDate(displayISO)} at{' '}
                {formatStoredTimeWithTZ(displayISO)}
              </span>
            )
          })()}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5"
            onClick={() => setEditingDateTime(!editingDateTime)}
          >
            <PencilSimple size={14} />
          </Button>
        </div>

        {/* Manual date/time editor */}
        {editingDateTime && (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="manual-date" className="text-xs">Date</Label>
              <Input
                id="manual-date"
                type="date"
                value={manualDate}
                onChange={e => setManualDate(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="manual-time" className="text-xs">Time</Label>
              <Input
                id="manual-time"
                type="time"
                value={manualTime}
                onChange={e => setManualTime(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <Button size="sm" className="h-8" onClick={handleApplyDateTime}>
              Apply
            </Button>
          </div>
        )}

        {/* GPS Status Indicator */}
        {hasGps ? (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle size={18} weight="fill" className="text-green-500" />
            <span className="text-green-600 dark:text-green-400 font-medium">GPS detected</span>
            <span className="text-muted-foreground">
              ({cluster.centerLat?.toFixed(4)}, {cluster.centerLon?.toFixed(4)})
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <XCircle size={18} weight="fill" className="text-amber-500" />
            <span className="text-amber-600 dark:text-amber-400 font-medium">No GPS data in photo</span>
          </div>
        )}
      </div>

      {/* Matching outing detected */}
      {matchingOuting && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">
                Add to existing outing?
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {matchingOuting.locationName} · {formatStoredDate(matchingOuting.startTime)}
              </p>
            </div>
            <Switch
              checked={useExistingOuting}
              onCheckedChange={setUseExistingOuting}
              aria-label="Add to existing outing?"
            />
          </div>
        </div>
      )}

      <>
          {!useExistingOuting && (
          <div className="space-y-2">
            <Label htmlFor="location-name">Location Name</Label>

            {isLoadingLocation ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span>Identifying location from GPS...</span>
              </div>
            ) : (
              <>
                <OutingNameAutocomplete
                  id="location-name"
                  value={locationName}
                  onChange={setLocationName}
                  outings={data.outings}
                  placeholder="e.g., Central Park, NYC"
                />
                {suggestedLocation && (
                  <p className="text-xs text-muted-foreground">
                    Suggested: {suggestedLocation}
                  </p>
                )}

                {/* Place search (#13) — search for a place by name */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Search for a place..."
                      value={placeQuery}
                      onChange={e => setPlaceQuery(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') searchPlace() }}
                      className="h-8 text-sm flex-1"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={searchPlace}
                      disabled={isSearchingPlace || !placeQuery.trim()}
                    >
                      <MagnifyingGlass size={14} />
                    </Button>
                  </div>
                  {isSearchingPlace && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      Searching...
                    </div>
                  )}
                  {placeResults.length > 0 && (
                    <div className="border rounded-md divide-y max-h-40 overflow-y-auto">
                      {placeResults.map((place, i) => (
                        <button
                          key={i}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-muted active:bg-muted/80 transition-colors"
                          onClick={() => selectPlace(place)}
                        >
                          {place.display_name}
                        </button>
                      ))}
                    </div>
                  )}
                  {overriddenCoords && (
                    <p className="text-xs text-green-600 dark:text-green-400">
                      Location set: {overriddenCoords.lat.toFixed(4)}, {overriddenCoords.lon.toFixed(4)}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
          )}

          <div className="space-y-2">
            <Label>Photos ({cluster.photos.length})</Label>
            <ScrollArea className="h-32">
              <div className="grid grid-cols-4 gap-2">
                {cluster.photos.map(photo => (
                  <img
                    key={photo.id}
                    src={photo.thumbnail}
                    alt="Bird"
                    className="w-full aspect-square object-cover rounded"
                  />
                ))}
              </div>
            </ScrollArea>
          </div>

          <Button
            onClick={handleConfirm}
            disabled={isLoadingLocation}
            className="w-full bg-primary text-primary-foreground"
          >
            {isLoadingLocation ? 'Loading...' : 'Continue to Species Identification'}
          </Button>
        </>
    </div>
  )
}
