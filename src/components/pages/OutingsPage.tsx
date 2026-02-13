import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MapPin, CalendarBlank, Camera } from '@phosphor-icons/react'
import { useBirdImage } from '@/hooks/use-bird-image'
import type { useBirdDexData } from '@/hooks/use-birddex-data'

interface OutingsPageProps {
  data: ReturnType<typeof useBirdDexData>
}

export default function OutingsPage({ data }: OutingsPageProps) {
  const { outings } = data

  if (outings.length === 0) {
    return (
      <div className="p-4 py-16 text-center space-y-2">
        <p className="text-lg text-muted-foreground">No outings yet</p>
        <p className="text-sm text-muted-foreground">
          Add photos to create your first outing
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="font-serif text-2xl font-semibold text-foreground">
        Your Outings
      </h2>
      
      <div className="space-y-3">
        {outings.map(outing => {
          const observations = data.getOutingObservations(outing.id)
          const photos = data.getOutingPhotos(outing.id)
          const confirmed = observations.filter(obs => obs.certainty === 'confirmed')

          return (
            <OutingCard
              key={outing.id}
              outing={outing}
              observations={observations}
              photos={photos}
              confirmed={confirmed}
            />
          )
        })}
      </div>
    </div>
  )
}

function OutingCard({
  outing,
  observations,
  photos,
  confirmed,
}: {
  outing: any
  observations: any[]
  photos: any[]
  confirmed: any[]
}) {
  // Use stored photo if available, otherwise try Wikipedia image of first confirmed species
  const firstSpecies = confirmed[0]?.speciesName
  const wikiImage = useBirdImage(firstSpecies)
  const heroSrc = photos[0]?.thumbnail || wikiImage

  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow">
      {heroSrc && (
        <div className="h-32 bg-muted overflow-hidden">
          <img
            src={heroSrc}
            alt={firstSpecies || 'Outing'}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </div>
      )}

      <div className="p-4 space-y-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarBlank size={16} />
            {new Date(outing.startTime).toLocaleDateString()} at{' '}
            {new Date(outing.startTime).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit'
            })}
          </div>
          {outing.locationName && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin size={16} weight="fill" className="text-primary" />
              {outing.locationName}
            </div>
          )}
          {photos.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Camera size={16} />
              {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {confirmed.map((obs: any) => (
            <Badge key={obs.id} variant="secondary">
              {obs.speciesName.split('(')[0].trim()}
              {obs.count > 1 && ` (×${obs.count})`}
            </Badge>
          ))}
        </div>

        {outing.notes && (
          <p className="text-sm text-muted-foreground italic">
            {outing.notes}
          </p>
        )}
      </div>
    </Card>
  )
}
