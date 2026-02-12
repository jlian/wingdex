import { useState } from 'react'
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
        <Input
          id="location-name"
          placeholder="e.g., Central Park, NYC"
          value={locationName}
          onChange={e => setLocationName(e.target.value)}
        />
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
        className="w-full bg-primary text-primary-foreground"
      >
        Continue to Species Identification
      </Button>
    </div>
  )
}
