import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { CheckCircle, Question, X as XIcon, Crop } from '@phosphor-icons/react'
import { toast } from 'sonner'
import type { useBirdDexData } from '@/hooks/use-birddex-data'
import type { SpeciesSuggestion, ObservationStatus, Photo } from '@/lib/types'

interface PhotoCluster {
  photos: any[]
  startTime: Date
  endTime: Date
  centerLat?: number
  centerLon?: number
}

interface SpeciesConfirmationProps {
  cluster: PhotoCluster
  suggestions: SpeciesSuggestion[]
  data: ReturnType<typeof useBirdDexData>
  photos?: Photo[]
  onComplete: (outingId: string) => void
  onCropPhoto?: (photoIndex: number) => void
}

interface SpeciesDecision {
  speciesName: string
  status: ObservationStatus
  count: number
  representativePhotoId?: string
}

export default function SpeciesConfirmation({
  cluster,
  suggestions,
  data,
  photos,
  onComplete,
  onCropPhoto
}: SpeciesConfirmationProps) {
  const [decisions, setDecisions] = useState<Map<string, SpeciesDecision>>(
    new Map(
      suggestions.map(s => [
        s.speciesName,
        {
          speciesName: s.speciesName,
          status: 'pending' as ObservationStatus,
          count: 1,
          representativePhotoId: s.supportingPhotos[0]
        }
      ])
    )
  )

  const handleStatusChange = (speciesName: string, status: ObservationStatus) => {
    setDecisions(prev => {
      const updated = new Map(prev)
      const existing = updated.get(speciesName)
      if (existing) {
        updated.set(speciesName, { ...existing, status })
      }
      return updated
    })
  }

  const handleCountChange = (speciesName: string, count: number) => {
    setDecisions(prev => {
      const updated = new Map(prev)
      const existing = updated.get(speciesName)
      if (existing) {
        updated.set(speciesName, { ...existing, count })
      }
      return updated
    })
  }

  const handleComplete = () => {
    const outingId = cluster.photos[0]?.outingId
    if (!outingId) return

    const observations = Array.from(decisions.values())
      .filter(d => d.status === 'confirmed' || d.status === 'possible')
      .map(d => ({
        id: `obs_${Date.now()}_${d.speciesName}`,
        outingId,
        speciesName: d.speciesName,
        count: d.count,
        certainty: d.status,
        representativePhotoId: d.representativePhotoId,
        notes: ''
      }))

    if (observations.length === 0) {
      toast.error('Please confirm at least one species')
      return
    }

    data.addObservations(observations)
    data.updateLifeList(outingId, observations)

    const newSpecies = observations.filter(obs => {
      const existing = data.getLifeListEntry(obs.speciesName)
      return !existing || existing.totalOutings === 1
    })

    if (newSpecies.length > 0) {
      toast.success(`🎉 ${newSpecies.length} new species added to your life list!`)
    }

    onComplete(outingId)
  }

  if (suggestions.length === 0) {
    return (
      <div className="space-y-4 py-8">
        <p className="text-center text-muted-foreground">
          No species suggestions available. You can add observations manually later.
        </p>
        <Button onClick={() => onComplete(cluster.photos[0]?.outingId)} className="w-full">
          Skip Species Identification
        </Button>
      </div>
    )
  }

  const confirmedCount = Array.from(decisions.values()).filter(
    d => d.status === 'confirmed' || d.status === 'possible'
  ).length

  return (
    <div className="space-y-4">
      {photos && onCropPhoto && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Photos</p>
          <div className="grid grid-cols-4 gap-2">
            {cluster.photos.map((photo, idx) => {
              const fullPhoto = photos.find(p => p.id === photo.id)
              const displaySrc = (fullPhoto as any)?.croppedDataUrl || photo.thumbnail
              const hasCrop = !!(fullPhoto as any)?.croppedDataUrl
              const isAICropped = !!(fullPhoto as any)?.aiCropped
              
              return (
                <div key={photo.id} className="relative group">
                  <img
                    src={displaySrc}
                    alt="Bird"
                    className={`w-full aspect-square object-cover rounded ${
                      hasCrop ? 'border-2' : 'border-2'
                    } ${
                      isAICropped ? 'border-accent' : hasCrop ? 'border-primary' : 'border-border'
                    }`}
                  />
                  {hasCrop && (
                    <div className={`absolute top-1 right-1 text-xs px-1.5 py-0.5 rounded shadow-sm font-medium ${
                      isAICropped ? 'bg-accent text-accent-foreground' : 'bg-primary text-primary-foreground'
                    }`}>
                      {isAICropped ? '🤖 AI' : '✂️ Manual'}
                    </div>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    className="absolute inset-0 m-auto w-10 h-10 p-0 opacity-0 group-hover:opacity-100 transition-opacity bg-background/90 hover:bg-background"
                    onClick={() => onCropPhoto(idx)}
                    title={hasCrop ? 'Refine crop' : 'Crop photo'}
                  >
                    <Crop size={18} weight="bold" />
                  </Button>
                </div>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Photos with <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent/20 text-accent font-medium">🤖 AI</span> borders were auto-cropped to focus on birds. Hover and click <Crop size={12} className="inline" weight="bold" /> to manually refine any crop for better identification.
          </p>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Review AI-suggested species and confirm your observations
        </p>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Confirmed:</span>
          <Badge variant="secondary">{confirmedCount} species</Badge>
        </div>
      </div>

      <div className="space-y-3 max-h-96 overflow-y-auto">
        {suggestions.map(suggestion => {
          const decision = decisions.get(suggestion.speciesName)
          if (!decision) return null

          const displayName = suggestion.speciesName.split('(')[0].trim()
          const confidence = Math.round(suggestion.confidence * 100)

          return (
            <Card key={suggestion.speciesName} className="p-3 space-y-3">
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <h3 className="font-serif font-semibold text-foreground">
                      {displayName}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      <Progress value={confidence} className="flex-1 h-1" />
                      <span className="text-xs text-muted-foreground">
                        {confidence}%
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={decision.status === 'confirmed' ? 'default' : 'outline'}
                    onClick={() => handleStatusChange(suggestion.speciesName, 'confirmed')}
                    className="flex-1"
                  >
                    <CheckCircle size={16} className="mr-1" weight="bold" />
                    Confirm
                  </Button>
                  <Button
                    size="sm"
                    variant={decision.status === 'possible' ? 'default' : 'outline'}
                    onClick={() => handleStatusChange(suggestion.speciesName, 'possible')}
                    className="flex-1"
                  >
                    <Question size={16} className="mr-1" weight="bold" />
                    Possible
                  </Button>
                  <Button
                    size="sm"
                    variant={decision.status === 'rejected' ? 'destructive' : 'outline'}
                    onClick={() => handleStatusChange(suggestion.speciesName, 'rejected')}
                  >
                    <XIcon size={16} weight="bold" />
                  </Button>
                </div>

                {(decision.status === 'confirmed' || decision.status === 'possible') && (
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-muted-foreground">Count:</label>
                    <Input
                      type="number"
                      min="1"
                      value={decision.count}
                      onChange={e =>
                        handleCountChange(
                          suggestion.speciesName,
                          Math.max(1, parseInt(e.target.value) || 1)
                        )
                      }
                      className="w-20"
                    />
                  </div>
                )}
              </div>
            </Card>
          )
        })}
      </div>

      <Button
        onClick={handleComplete}
        className="w-full bg-accent text-accent-foreground"
        disabled={confirmedCount === 0}
      >
        Save Outing ({confirmedCount} species)
      </Button>
    </div>
  )
}
