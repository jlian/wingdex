import { Button } from '@/components/ui/button'
import {
  MapPin, Camera, Bird, ArrowRight
} from '@phosphor-icons/react'
import { useBirdImage } from '@/hooks/use-bird-image'
import { getDisplayName } from '@/lib/utils'
import { formatStoredDate } from '@/lib/timezone'
import type { BirdDexDataStore } from '@/hooks/use-birddex-data'

interface HomePageProps {
  data: BirdDexDataStore
  onAddPhotos: () => void
  onSelectOuting: (id: string) => void
  onSelectSpecies: (name: string) => void
  onNavigate: (tab: string) => void
}

export default function HomePage({ data, onAddPhotos, onSelectOuting, onSelectSpecies, onNavigate }: HomePageProps) {
  const { outings, dex } = data

  const recentOutings = outings
    .slice()
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
    .slice(0, 5)
  const recentSpecies = dex
    .slice()
    .sort((a, b) => new Date(b.addedDate || b.firstSeenDate).getTime() - new Date(a.addedDate || a.firstSeenDate).getTime())
    .slice(0, 6)

  const thisMonth = new Date()
  const thisMonthStart = new Date(thisMonth.getFullYear(), thisMonth.getMonth(), 1)
  const newThisMonth = dex.filter(entry => {
    const dateStr = entry.addedDate || entry.firstSeenDate
    return new Date(dateStr) >= thisMonthStart
  }).length

  const totalPhotos = data.photos.length

  if (dex.length === 0) {
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
              Got bird pics?
            </h2>
            <p className="text-muted-foreground text-base sm:text-lg leading-relaxed">
              Upload your pics, ID the birds, and build your
              BirdDex. <em>Reverse birding</em> at its finest.
            </p>
          </div>
          <Button
            size="lg"
            onClick={onAddPhotos}
            className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-md"
          >
            <Camera size={20} className="mr-2" weight="bold" />
            Upload & Identify
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="pb-8 animate-fade-in">
      {/* ── Hero ─────────────────────────────────────── */}
      <div className="px-4 sm:px-6 py-8 sm:py-10 max-w-3xl mx-auto border-b border-border/40">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-4">
            <div className="flex items-baseline gap-3">
              <p className="font-serif text-5xl sm:text-6xl font-semibold text-foreground tracking-tight leading-none">
                {dex.length}
              </p>
              <p className="font-serif text-lg sm:text-xl text-muted-foreground">
                species observed
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              <button onClick={() => onNavigate('outings')} className="hover:text-foreground transition-colors cursor-pointer">
                <span className="font-semibold text-foreground">{outings.length}</span> outings
              </button>
              {totalPhotos > 0 && (
                <>
                  <span className="mx-1.5 text-border">·</span>
                  <span><span className="font-semibold text-foreground">{totalPhotos}</span> photos</span>
                </>
              )}
              {newThisMonth > 0 && (
                <>
                  <span className="mx-1.5 text-border">·</span>
                  <span><span className="font-semibold text-foreground">{newThisMonth}</span> new this month</span>
                </>
              )}
            </p>
          </div>
          <button
            onClick={onAddPhotos}
            className="group relative flex-shrink-0 h-16 w-16 rounded-2xl cursor-pointer
              bg-gradient-to-b from-primary/90 to-primary
              shadow-[0_2px_8px_rgba(0,0,0,0.12),0_6px_20px_rgba(0,0,0,0.08),inset_0_1px_1px_rgba(255,255,255,0.15)]
              hover:shadow-[0_4px_12px_rgba(0,0,0,0.15),0_8px_28px_rgba(0,0,0,0.10),inset_0_1px_1px_rgba(255,255,255,0.2)]
              hover:scale-[1.04] active:scale-[0.97]
              transition-all duration-200 ease-out"
            aria-label="Upload & Identify"
          >
            <span className="absolute inset-0 flex items-center justify-center text-primary-foreground">
              <Camera size={26} weight="bold" />
            </span>
          </button>
        </div>
      </div>

      {/* ── Recent Species ─────────────────────────────── */}
      <div className="px-4 sm:px-6 space-y-6 pt-5 max-w-3xl mx-auto">
        {recentSpecies.length > 0 && (
          <section className="space-y-3 animate-fade-in">
            <div className="flex items-center justify-between">
              <h3 className="font-serif text-lg font-semibold text-foreground">
                Recent Species
              </h3>
              {dex.length > 6 && (
                <button
                  onClick={() => onNavigate('birddex')}
                  className="text-xs text-primary hover:text-primary/80 flex items-center gap-1 font-medium transition-colors cursor-pointer"
                >
                  View all {dex.length}
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
          <section className="space-y-3 animate-fade-in">
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
            <div>
              {recentOutings.map(outing => {
                const observations = data.getOutingObservations(outing.id)
                const confirmed = observations.filter(
                  obs => obs.certainty === 'confirmed'
                )

                return (
                  <button
                    key={outing.id}
                    className="flex items-center gap-3 px-2 rounded-lg w-full text-left cursor-pointer hover:bg-muted/30 active:bg-muted transition-colors"
                    onClick={() => onSelectOuting(outing.id)}
                  >
                    <MapPin size={16} className="text-muted-foreground/50 flex-shrink-0" />
                    <div className="flex-1 min-w-0 border-b border-border py-3">
                      <p className="font-serif font-semibold text-sm text-foreground truncate">
                        {outing.locationName || 'Outing'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatStoredDate(outing.startTime)} · {confirmed.length} species
                      </p>
                      {confirmed.length > 0 && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {confirmed.slice(0, 3).map(obs => getDisplayName(obs.speciesName)).join(', ')}
                          {confirmed.length > 3 && ` +${confirmed.length - 3}`}
                        </p>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </section>
        )}

      </div>
    </div>
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
