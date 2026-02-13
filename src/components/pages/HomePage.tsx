import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  MapPin, Camera, Bird,
  Binoculars, Image as ImageIcon, ArrowRight
} from '@phosphor-icons/react'
import { useBirdImage } from '@/hooks/use-bird-image'
import { getDisplayName } from '@/lib/utils'
import type { BirdDexDataStore } from '@/hooks/use-birddex-data'

interface HomePageProps {
  data: BirdDexDataStore
  onAddPhotos: () => void
  onSelectOuting: (id: string) => void
  onSelectSpecies: (name: string) => void
  onNavigate: (tab: string) => void
}

export default function HomePage({ data, onAddPhotos, onSelectOuting, onSelectSpecies, onNavigate }: HomePageProps) {
  const { outings, lifeList } = data

  const recentOutings = outings.slice(0, 5)
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
              life list. <em>Reverse birding</em> at its finest.
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
        <div className="px-4 sm:px-6 py-6 sm:py-8 max-w-3xl mx-auto">
          <div className="grid sm:grid-cols-2 gap-6 items-center">
            <div className="space-y-4">
              <div className="space-y-2">
                <h2 className="font-serif text-2xl sm:text-3xl lg:text-4xl font-semibold text-foreground leading-tight">
                  Got bird photos?
                </h2>
                <p className="text-muted-foreground text-base sm:text-lg leading-relaxed">
                  Upload your photos, let AI identify the species, and build your
                  life list. <em>Reverse birding</em> at its finest.
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

            <div className="grid grid-cols-2 gap-2 sm:gap-3">
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
      <div className="px-4 sm:px-6 space-y-6 pt-5 max-w-3xl mx-auto">
        {recentSpecies.length > 0 && (
          <section className="space-y-3 animate-slide-up">
            <div className="flex items-center justify-between">
              <h3 className="font-serif text-lg font-semibold text-foreground">
                Recent Species
              </h3>
              {lifeList.length > 6 && (
                <button
                  onClick={() => onNavigate('lifelist')}
                  className="text-xs text-primary hover:text-primary/80 flex items-center gap-1 font-medium transition-colors cursor-pointer"
                >
                  View all {lifeList.length}
                  <ArrowRight size={12} />
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-6 gap-2">
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
          <section className="space-y-3 animate-slide-up stagger-4">
            <div className="flex items-center justify-between">
              <h3 className="font-serif text-lg font-semibold text-foreground">
                Recent Outings
              </h3>
              {outings.length > 5 && (
                <button
                  onClick={() => onNavigate('outings')}
                  className="text-xs text-primary hover:text-primary/80 flex items-center gap-1 font-medium transition-colors cursor-pointer"
                >
                  View all {outings.length}
                  <ArrowRight size={12} />
                </button>
              )}
            </div>
            <div className="divide-y divide-border">
              {recentOutings.map(outing => {
                const observations = data.getOutingObservations(outing.id)
                const confirmed = observations.filter(
                  obs => obs.certainty === 'confirmed'
                )

                return (
                  <button
                    key={outing.id}
                    className="flex items-center gap-3 py-2.5 w-full text-left hover:bg-muted/50 transition-colors cursor-pointer active:bg-muted"
                    onClick={() => onSelectOuting(outing.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-serif font-semibold text-sm text-foreground truncate">
                        {outing.locationName || 'Outing'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(outing.startTime).toLocaleDateString()} · {confirmed.length} species
                      </p>
                      {confirmed.length > 0 && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {confirmed.slice(0, 3).map(obs => getDisplayName(obs.speciesName)).join(', ')}
                          {confirmed.length > 3 && ` +${confirmed.length - 3}`}
                        </p>
                      )}
                    </div>
                    <MapPin size={16} className="text-muted-foreground/50 flex-shrink-0" />
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {/* ── Birding Highlights ────────────────────────── */}
        <section className="pt-2">
          <div className="border-t border-border/40 pt-6 space-y-3">
            <h3 className="font-serif text-lg font-semibold text-foreground">
              Highlights
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(() => {
                const mostSeen = lifeList.slice().sort((a, b) => b.totalCount - a.totalCount)[0]
                const firstSeen = lifeList.slice().sort((a, b) =>
                  new Date(a.addedDate || a.firstSeenDate).getTime() - new Date(b.addedDate || b.firstSeenDate).getTime()
                )[0]
                const bestOuting = outings.reduce<{ name: string; count: number } | null>((best, o) => {
                  const count = data.getOutingObservations(o.id).filter(obs => obs.certainty === 'confirmed').length
                  if (!best || count > best.count) return { name: o.locationName || 'Outing', count }
                  return best
                }, null)
                return (
                  <>
                    {mostSeen && (
                      <button
                        onClick={() => onSelectSpecies(mostSeen.speciesName)}
                        className="p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors text-left cursor-pointer"
                      >
                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Most Seen</p>
                        <p className="font-serif font-semibold text-sm text-foreground mt-1 truncate">
                          {getDisplayName(mostSeen.speciesName)}
                        </p>
                        <p className="text-xs text-muted-foreground">{mostSeen.totalCount} total</p>
                      </button>
                    )}
                    {firstSeen && (
                      <button
                        onClick={() => onSelectSpecies(firstSeen.speciesName)}
                        className="p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors text-left cursor-pointer"
                      >
                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">First Species</p>
                        <p className="font-serif font-semibold text-sm text-foreground mt-1 truncate">
                          {getDisplayName(firstSeen.speciesName)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(firstSeen.addedDate || firstSeen.firstSeenDate).toLocaleDateString()}
                        </p>
                      </button>
                    )}
                    {bestOuting && (
                      <button
                        onClick={() => {
                          const o = outings.reduce<{ id: string; count: number } | null>((best, outing) => {
                            const count = data.getOutingObservations(outing.id).filter(obs => obs.certainty === 'confirmed').length
                            if (!best || count > best.count) return { id: outing.id, count }
                            return best
                          }, null)
                          if (o) onSelectOuting(o.id)
                        }}
                        className="p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors text-left cursor-pointer"
                      >
                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Best Outing</p>
                        <p className="font-serif font-semibold text-sm text-foreground mt-1 truncate">
                          {bestOuting.name}
                        </p>
                        <p className="text-xs text-muted-foreground">{bestOuting.count} species</p>
                      </button>
                    )}
                  </>
                )
              })()}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function StatCard({ value, label, accent }: { value: number; label: string; accent: string }) {
  return (
    <Card className="p-3 sm:p-4 space-y-0.5 text-center">
      <div className={`text-xl sm:text-2xl font-bold font-serif ${accent}`}>
        {value}
      </div>
      <div className="text-[11px] sm:text-xs text-muted-foreground">{label}</div>
    </Card>
  )
}

function SpeciesCard({ speciesName, date, onClick }: { speciesName: string; date: string; onClick: () => void }) {
  const displayName = getDisplayName(speciesName)
  const wikiImage = useBirdImage(speciesName)

  return (
    <button
      className="overflow-hidden rounded-lg bg-card border border-border hover:shadow-md transition-shadow cursor-pointer active:scale-[0.98] text-left"
      onClick={onClick}
    >
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
            <Bird size={24} className="text-muted-foreground/40" />
          </div>
        )}
      </div>
      <div className="px-2 py-1.5">
        <p className="font-serif text-xs font-semibold text-foreground truncate">
          {displayName}
        </p>
      </div>
    </button>
  )
}
