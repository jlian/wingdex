import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  CloudArrowUp, MapPin, CalendarBlank, Camera, Bird,
  ArrowRight, Binoculars, Image as ImageIcon
} from '@phosphor-icons/react'
import { useBirdImage } from '@/hooks/use-bird-image'
import type { useBirdDexData } from '@/hooks/use-birddex-data'

interface HomePageProps {
  data: ReturnType<typeof useBirdDexData>
  onAddPhotos: () => void
  onSelectOuting: (id: string) => void
  onSelectSpecies: (name: string) => void
}

export default function HomePage({ data, onAddPhotos, onSelectOuting, onSelectSpecies }: HomePageProps) {
  const { outings, lifeList } = data

  const recentOutings = outings.slice(0, 3)
  const recentSpecies = lifeList
    .slice()
    .sort((a, b) => new Date(b.addedDate || b.firstSeenDate).getTime() - new Date(a.addedDate || a.firstSeenDate).getTime())
    .slice(0, 6)

  const thisMonth = new Date()
  const thisMonthStart = new Date(thisMonth.getFullYear(), thisMonth.getMonth(), 1)
  const newThisMonth = lifeList.filter(entry => {
    const dateStr = entry.addedDate || entry.firstSeenDate
    return new Date(dateStr) >= thisMonthStart
  }).length

  const totalPhotos = data.photos.length

  if (lifeList.length === 0) {
    return (
      <div className="px-4 sm:px-6 py-16 sm:py-24">
        <div className="max-w-md mx-auto text-center space-y-6">
          <div className="flex justify-center">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
              <Bird size={40} className="text-primary" weight="duotone" />
            </div>
          </div>
          <div className="space-y-3">
            <h2 className="font-serif text-3xl sm:text-4xl font-semibold text-foreground leading-tight">
              Got bird photos?
            </h2>
            <p className="text-muted-foreground text-base sm:text-lg leading-relaxed">
              Upload your photos, let AI identify the species, and build your
              life list — <em>reverse birding</em> at its finest.
            </p>
          </div>
          <Button
            size="lg"
            onClick={onAddPhotos}
            className="bg-accent text-accent-foreground hover:bg-accent/90 shadow-md"
          >
            <Camera size={20} className="mr-2" weight="bold" />
            Upload &amp; Identify
          </Button>
          <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <ImageIcon size={16} /> AI-powered ID
            </span>
            <span className="flex items-center gap-1.5">
              <Bird size={16} /> Auto life list
            </span>
            <span className="flex items-center gap-1.5">
              <Binoculars size={16} /> eBird export
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pb-8">
      {/* ── Hero + Stats ───────────────────────────────── */}
      <section className="border-b border-border/40">
        <div className="px-4 sm:px-6 py-8 sm:py-12">
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div className="space-y-5">
              <div className="space-y-3">
                <h2 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-semibold text-foreground leading-tight">
                  Got bird photos?
                </h2>
                <p className="text-muted-foreground text-base sm:text-lg leading-relaxed">
                  Upload your photos, let AI identify the species, and build your
                  life list — <em>reverse birding</em> at its finest.
                </p>
              </div>
              <Button
                size="lg"
                onClick={onAddPhotos}
                className="bg-accent text-accent-foreground hover:bg-accent/90 shadow-md"
              >
                <Camera size={20} className="mr-2" weight="bold" />
                Upload &amp; Identify
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <StatCard
                value={lifeList.length}
                label="Species"
                accent="text-primary"
              />
              <StatCard
                value={outings.length}
                label="Outings"
                accent="text-secondary"
              />
              <StatCard
                value={newThisMonth}
                label="New This Month"
                accent="text-accent"
              />
              <StatCard
                value={totalPhotos}
                label="Photos"
                accent="text-muted-foreground"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── Recent Species ─────────────────────────────── */}
      <div className="px-4 sm:px-6 space-y-8 pt-6">
        {recentSpecies.length > 0 && (
          <section className="space-y-4 animate-slide-up">
            <h3 className="font-serif text-xl font-semibold text-foreground">
              Recent Species
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {recentSpecies.map(entry => (
                <SpeciesCard
                  key={entry.speciesName}
                  speciesName={entry.speciesName}
                  date={entry.addedDate || entry.firstSeenDate}
                  onClick={() => onSelectSpecies(entry.speciesName)}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Recent Outings ─────────────────────────────── */}
        {recentOutings.length > 0 && (
          <section className="space-y-4 animate-slide-up stagger-4">
            <h3 className="font-serif text-xl font-semibold text-foreground">
              Recent Outings
            </h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {recentOutings.map(outing => {
                const observations = data.getOutingObservations(outing.id)
                const confirmed = observations.filter(
                  obs => obs.certainty === 'confirmed'
                )

                return (
                  <Card key={outing.id} className="p-4 space-y-3 hover:shadow-md transition-shadow cursor-pointer active:scale-[0.99]" onClick={() => onSelectOuting(outing.id)}>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CalendarBlank size={15} />
                        {new Date(outing.startTime).toLocaleDateString()}
                      </div>
                      {outing.locationName && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <MapPin size={15} weight="fill" className="text-primary" />
                          <span className="truncate">{outing.locationName}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {confirmed.slice(0, 4).map(obs => (
                        <Badge key={obs.id} variant="secondary" className="text-xs">
                          {obs.speciesName.split('(')[0].trim()}
                        </Badge>
                      ))}
                      {confirmed.length > 4 && (
                        <Badge variant="outline" className="text-xs">
                          +{confirmed.length - 4} more
                        </Badge>
                      )}
                    </div>
                  </Card>
                )
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function StatCard({ value, label, accent }: { value: number; label: string; accent: string }) {
  return (
    <Card className="p-4 sm:p-5 space-y-1 text-center">
      <div className={`text-2xl sm:text-3xl font-bold font-serif ${accent}`}>
        {value}
      </div>
      <div className="text-xs sm:text-sm text-muted-foreground">{label}</div>
    </Card>
  )
}

function SpeciesCard({ speciesName, date, onClick }: { speciesName: string; date: string; onClick: () => void }) {
  const displayName = speciesName.split('(')[0].trim()
  const wikiImage = useBirdImage(speciesName)

  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow cursor-pointer active:scale-[0.99]" onClick={onClick}>
      <div className="aspect-square bg-muted overflow-hidden">
        {wikiImage ? (
          <img
            src={wikiImage}
            alt={displayName}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Bird size={32} className="text-muted-foreground/40" />
          </div>
        )}
      </div>
      <div className="p-2.5">
        <p className="font-serif text-sm font-semibold text-foreground truncate">
          {displayName}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {new Date(date).toLocaleDateString()}
        </p>
      </div>
    </Card>
  )
}
