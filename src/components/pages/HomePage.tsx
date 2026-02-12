import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CloudArrowUp, MapPin, CalendarBlank } from '@phosphor-icons/react'
import TestHelper from '@/components/TestHelper'
import type { useBirdDexData } from '@/hooks/use-birddex-data'

interface HomePageProps {
  data: ReturnType<typeof useBirdDexData>
  onAddPhotos: () => void
  onTestPhotoReady?: (file: File) => void
}

export default function HomePage({ data, onAddPhotos, onTestPhotoReady }: HomePageProps) {
  const { outings, lifeList } = data

  const recentOutings = outings.slice(0, 5)
  
  const thisMonth = new Date()
  const thisMonthStart = new Date(thisMonth.getFullYear(), thisMonth.getMonth(), 1)
  const newThisMonth = lifeList.filter(entry => {
    const firstSeen = new Date(entry.firstSeenDate)
    return firstSeen >= thisMonthStart
  }).length

  return (
    <div className="p-4 space-y-6">
      {onTestPhotoReady && (
        <TestHelper onTestPhotoReady={onTestPhotoReady} />
      )}
      
      <section className="space-y-4">
        <div className="text-center py-8 space-y-4">
          <h2 className="font-serif text-3xl font-semibold text-foreground">
            Welcome to your Bird-Dex
          </h2>
          <p className="text-muted-foreground">
            Track your sightings and build your life list
          </p>
          <Button
            size="lg"
            onClick={onAddPhotos}
            className="bg-accent text-accent-foreground hover:bg-accent/90"
          >
            <CloudArrowUp size={20} className="mr-2" weight="bold" />
            Add Photos
          </Button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-4">
        <Card className="p-4 space-y-1">
          <div className="text-3xl font-bold text-primary font-serif">
            {lifeList.length}
          </div>
          <div className="text-sm text-muted-foreground">Total Species</div>
        </Card>
        <Card className="p-4 space-y-1">
          <div className="text-3xl font-bold text-accent font-serif">
            {newThisMonth}
          </div>
          <div className="text-sm text-muted-foreground">New This Month</div>
        </Card>
      </section>

      {recentOutings.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-lg font-semibold text-foreground">
            Recent Outings
          </h3>
          <div className="space-y-3">
            {recentOutings.map(outing => {
              const observations = data.getOutingObservations(outing.id)
              const confirmed = observations.filter(
                obs => obs.certainty === 'confirmed'
              )
              
              return (
                <Card key={outing.id} className="p-4 space-y-2 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CalendarBlank size={16} />
                        {new Date(outing.startTime).toLocaleDateString()}
                      </div>
                      {outing.locationName && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <MapPin size={16} />
                          {outing.locationName}
                        </div>
                      )}
                    </div>
                    <Badge variant="secondary">
                      {confirmed.length} {confirmed.length === 1 ? 'species' : 'species'}
                    </Badge>
                  </div>
                </Card>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
