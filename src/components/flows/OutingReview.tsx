import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MapPin, CalendarBlank, CheckCircle, XCircle } from '@phosphor-icons/react'
import type { useBirdDexData } from '@/hooks/use-birddex-data'

interface PhotoCluster {
  photos: any[]
  startTime: Date
  endTime: Date
  centerLat?: number
  centerLon?: number
}

interface OutingReviewProps {
  cluster: PhotoCluster
  data: ReturnType<typeof useBirdDexData>
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
  const hasGps = !!(cluster.centerLat && cluster.centerLon)
  const [locationName, setLocationName] = useState(defaultLocationName)
  const [isLoadingLocation, setIsLoadingLocation] = useState(hasGps)
  const [suggestedLocation, setSuggestedLocation] = useState(defaultLocationName)

  useEffect(() => {
    if (hasGps) {
      fetchLocationName(cluster.centerLat!, cluster.centerLon!)
    }
  }, [cluster.centerLat, cluster.centerLon])

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
    const outingId = `outing_${Date.now()}`
    const outing = {
      id: outingId,
      userId: userId.toString(),
      startTime: cluster.startTime.toISOString(),
      endTime: cluster.endTime.toISOString(),
      locationName: name || 'Unknown Location',
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
        {cluster.centerLat && cluster.centerLon ? (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle size={18} weight="fill" className="text-green-500" />
            <span className="text-green-600 font-medium">GPS detected</span>
            <span className="text-muted-foreground">
              ({cluster.centerLat.toFixed(4)}, {cluster.centerLon.toFixed(4)})
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <XCircle size={18} weight="fill" className="text-amber-500" />
            <span className="text-amber-600 font-medium">No GPS data in photo</span>
          </div>
        )}
      </div>

      <>
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
