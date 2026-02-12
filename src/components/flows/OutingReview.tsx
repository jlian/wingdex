import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MapPin, CalendarBlank } from '@phosphor-icons/react'
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
  onConfirm
}: OutingReviewProps) {
  const [locationName, setLocationName] = useState('')
  const [isLoadingLocation, setIsLoadingLocation] = useState(false)
  const [suggestedLocation, setSuggestedLocation] = useState('')

  useEffect(() => {
    if (cluster.centerLat && cluster.centerLon) {
      fetchLocationName(cluster.centerLat, cluster.centerLon)
    }
  }, [cluster.centerLat, cluster.centerLon])

  const fetchLocationName = async (lat: number, lon: number) => {
    setIsLoadingLocation(true)
    try {
      const prompt = (window.spark.llmPrompt as any)`Given GPS coordinates ${lat.toFixed(6)}, ${lon.toFixed(6)}, identify the most likely location name for a bird watching outing.

Consider:
- Named parks, nature reserves, wildlife refuges, or conservation areas
- City parks or urban green spaces
- Lakes, rivers, beaches, or coastal areas
- General geographic areas (city, region, state)

Return ONLY the location name as a concise string. Examples:
- "Golden Gate Park, San Francisco, CA"
- "Central Park, New York, NY"
- "Everglades National Park, FL"
- "Monterey Bay, CA"
- "Austin, TX"

Location name:`
      
      const response = await window.spark.llm(prompt, 'gpt-4o-mini', false)
      const cleanName = response.trim().replace(/^["']|["']$/g, '').split('\n')[0]
      setSuggestedLocation(cleanName)
      setLocationName(cleanName)
    } catch (error) {
      console.error('Failed to fetch location name:', error)
      const fallback = `Location ${lat.toFixed(4)}, ${lon.toFixed(4)}`
      setSuggestedLocation(fallback)
      setLocationName(fallback)
    } finally {
      setIsLoadingLocation(false)
    }
  }

  const handleConfirm = () => {
    const outingId = `outing_${Date.now()}`
    
    const outing = {
      id: outingId,
      userId: userId.toString(),
      startTime: cluster.startTime.toISOString(),
      endTime: cluster.endTime.toISOString(),
      locationName: locationName || 'Unknown Location',
      lat: cluster.centerLat,
      lon: cluster.centerLon,
      notes: '',
      createdAt: new Date().toISOString()
    }

    data.addOuting(outing)
    
    onConfirm(
      outingId,
      locationName || 'Unknown Location',
      cluster.centerLat,
      cluster.centerLon
    )
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

        {cluster.centerLat && cluster.centerLon && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin size={18} weight="fill" className="text-primary" />
            <span>
              {cluster.centerLat.toFixed(4)}, {cluster.centerLon.toFixed(4)}
            </span>
          </div>
        )}
      </div>

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
    </div>
  )
}
