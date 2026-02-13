import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MapPin, CalendarBlank, CheckCircle, XCircle, ArrowsClockwise } from '@phosphor-icons/react'
import { findMatchingOuting } from '@/lib/clustering'
import type { BirdDexDataStore } from '@/hooks/use-birddex-data'
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
  data: BirdDexDataStore
  userId: number
  /** Pre-fill location from a previous outing (user can override) */
  defaultLocationName?: string
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
  onConfirm
}: OutingReviewProps) {
  const hasGps = cluster.centerLat !== undefined && cluster.centerLon !== undefined
  const [locationName, setLocationName] = useState(defaultLocationName)
  const [isLoadingLocation, setIsLoadingLocation] = useState(false)
  const [suggestedLocation, setSuggestedLocation] = useState(defaultLocationName)
  const [hasRequestedLookup, setHasRequestedLookup] = useState(false)

  // Check if these photos match an existing outing
  const matchingOuting = findMatchingOuting(cluster, data.outings)
  const [useExistingOuting, setUseExistingOuting] = useState(!!matchingOuting)

  useEffect(() => {
    setHasRequestedLookup(false)
  }, [cluster.startTime, cluster.endTime])

  const fetchLocationName = async (lat: number, lon: number) => {
    setIsLoadingLocation(true)
    try {
      // Use OpenStreetMap Nominatim for reliable reverse geocoding (no auth needed)
      console.log('📍 Reverse geocoding via Nominatim...')
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=14&addressdetails=1`
      const res = await fetch(url, {
        headers: { 'User-Agent': 'BirdDex-App/1.0' },
      })
      
      if (!res.ok) throw new Error(`Nominatim ${res.status}`)
      
      const data = await res.json()
      let name = ''
      
      if (data.address) {
        const a = data.address
        // Build a concise location: prefer park/reserve, then suburb/city, then country
        const parts: string[] = []
        if (a.park || a.nature_reserve || a.leisure) {
          parts.push(a.park || a.nature_reserve || a.leisure)
        }
        if (a.suburb || a.neighbourhood || a.village || a.town) {
          parts.push(a.suburb || a.neighbourhood || a.village || a.town)
        }
        if (a.city || a.county) {
          parts.push(a.city || a.county)
        }
        if (a.state) parts.push(a.state)
        if (a.country) parts.push(a.country)
        name = parts.filter(Boolean).slice(0, 3).join(', ')
      }
      
      if (!name && data.display_name) {
        // Fallback to shortened display_name
        name = data.display_name.split(',').slice(0, 3).join(',').trim()
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
      // Merge into existing outing — expand its time window if needed
      const existingStart = new Date(matchingOuting.startTime).getTime()
      const existingEnd = new Date(matchingOuting.endTime).getTime()
      const clusterStart = cluster.startTime.getTime()
      const clusterEnd = cluster.endTime.getTime()

      if (clusterStart < existingStart || clusterEnd > existingEnd) {
        data.updateOuting(matchingOuting.id, {
          startTime: new Date(Math.min(existingStart, clusterStart)).toISOString(),
          endTime: new Date(Math.max(existingEnd, clusterEnd)).toISOString(),
        })
      }

      onConfirm(matchingOuting.id, matchingOuting.locationName, matchingOuting.lat, matchingOuting.lon)
      return
    }

    const outingId = `outing_${Date.now()}`
    const outing = {
      id: outingId,
      userId: userId.toString(),
      startTime: cluster.startTime.toISOString(),
      endTime: cluster.endTime.toISOString(),
      locationName: name || 'Unknown Location',
      defaultLocationName: name || 'Unknown Location',
      lat: cluster.centerLat,
      lon: cluster.centerLon,
      notes: '',
      createdAt: new Date().toISOString()
    }

    data.addOuting(outing)
    onConfirm(outingId, name || 'Unknown Location', cluster.centerLat, cluster.centerLon)
  }

  const handleConfirm = () => doConfirm(locationName)

  const handleLookupLocation = () => {
    if (!hasGps) return
    setHasRequestedLookup(true)
    const roundedLat = Number(cluster.centerLat!.toFixed(3))
    const roundedLon = Number(cluster.centerLon!.toFixed(3))
    void fetchLocationName(roundedLat, roundedLon)
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarBlank size={18} />
          <span>
            {cluster.startTime.toLocaleDateString()} at{' '}
            {cluster.startTime.toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit'
            })}
          </span>
        </div>

        {/* GPS Status Indicator */}
        {hasGps ? (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle size={18} weight="fill" className="text-green-500" />
            <span className="text-green-600 dark:text-green-400 font-medium">GPS detected</span>
            <span className="text-muted-foreground">
              ({cluster.centerLat.toFixed(4)}, {cluster.centerLon.toFixed(4)})
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
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <ArrowsClockwise size={16} weight="bold" />
            Matches existing outing
          </div>
          <p className="text-xs text-muted-foreground">
            {matchingOuting.locationName} · {new Date(matchingOuting.startTime).toLocaleDateString()}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={useExistingOuting ? 'default' : 'outline'}
              onClick={() => setUseExistingOuting(true)}
              className="flex-1"
            >
              Add to this outing
            </Button>
            <Button
              size="sm"
              variant={!useExistingOuting ? 'default' : 'outline'}
              onClick={() => setUseExistingOuting(false)}
              className="flex-1"
            >
              New outing
            </Button>
          </div>
        </div>
      )}

      <>
          {!useExistingOuting && (
          <div className="space-y-2">
            <Label htmlFor="location-name">Location Name</Label>
            {hasGps && !hasRequestedLookup && !isLoadingLocation && (
              <div className="rounded-md border border-border bg-muted/40 p-2 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Use GPS to suggest a location name. Approximate coordinates are sent to OpenStreetMap Nominatim.
                </p>
                <Button type="button" variant="outline" size="sm" onClick={handleLookupLocation}>
                  <MapPin size={14} className="mr-1" />
                  Use GPS to Suggest Name
                </Button>
              </div>
            )}
            {isLoadingLocation ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span>Identifying location from GPS...</span>
              </div>
            ) : (
              <>
                <Input
                  id="location-name"
                  placeholder="e.g., Central Park, NYC"
                  value={locationName}
                  onChange={e => setLocationName(e.target.value)}
                />
                {suggestedLocation && (
                  <p className="text-xs text-muted-foreground">
                    Suggested: {suggestedLocation}
                  </p>
                )}
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
