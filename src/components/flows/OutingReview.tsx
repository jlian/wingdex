import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { CalendarBlank, CheckCircle, XCircle, ArrowsClockwise, Clock } from '@phosphor-icons/react'
import { findMatchingOuting } from '@/lib/clustering'
import { format } from 'date-fns'
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
  
  // Date and time editing
  const [selectedDate, setSelectedDate] = useState<Date>(cluster.startTime)
  const [timeString, setTimeString] = useState(
    cluster.startTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  )

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

    // Parse user-edited time with validation
    const timeParts = timeString.split(':').map(Number)
    const hours = timeParts[0] ?? 0
    const minutes = timeParts[1] ?? 0
    
    // Validate time values
    if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      toast.error('Invalid time format. Please use HH:MM format.')
      return
    }
    
    const startTime = new Date(selectedDate)
    startTime.setHours(hours, minutes, 0, 0)
    
    // Calculate end time (1 hour after start by default)
    const ONE_HOUR_MS = 60 * 60 * 1000
    const endTime = new Date(startTime.getTime() + ONE_HOUR_MS)

    const outingId = `outing_${Date.now()}`
    const outing = {
      id: outingId,
      userId: userId.toString(),
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
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


  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {/* Date and Time Picker */}
        <div className="space-y-2">
          <Label>Date &amp; Time</Label>
          <div className="flex gap-2">
            {/* Date picker */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="flex-1 justify-start text-left font-normal"
                >
                  <CalendarBlank size={18} className="mr-2" />
                  {format(selectedDate, 'PPP')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => date && setSelectedDate(date)}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
            
            {/* Time input */}
            <div className="flex items-center gap-2 flex-1">
              <Clock size={18} className="text-muted-foreground" />
              <Input
                type="time"
                value={timeString}
                onChange={(e) => setTimeString(e.target.value)}
                className="flex-1"
              />
            </div>
          </div>
        </div>

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
