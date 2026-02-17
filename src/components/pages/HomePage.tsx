import { Button } from '@/components/ui/button'
import {
  MapPin, Camera, Bird, ArrowRight
} from '@phosphor-icons/react'
import { useBirdImage } from '@/hooks/use-bird-image'
import { getDisplayName } from '@/lib/utils'
import { formatStoredDate } from '@/lib/timezone'
import type { WingDexDataStore } from '@/hooks/use-wingdex-data'

interface HomePageProps {
  data: WingDexDataStore
  onAddPhotos: () => void
  onAddPhotosIntent?: () => void
  onSelectOuting: (id: string) => void
  onSelectSpecies: (name: string) => void
  onNavigate: (tab: string) => void
}

export function HomeContentSkeleton() {
  return (
    <>
      {/* Hero skeleton */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-12 w-20 rounded-md bg-muted animate-pulse" />
          <div className="h-5 w-36 rounded-md bg-muted animate-pulse" />
        </div>
        <div className="h-12 w-24 rounded-xl bg-muted animate-pulse" />
      </div>

      {/* Recent Species skeleton */}
      <div className="space-y-3 pt-2">
        <div className="h-6 w-32 rounded-md bg-muted animate-pulse" />
        <div className="flex gap-3 overflow-hidden">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="w-28 flex-shrink-0 space-y-2">
              <div className="aspect-square rounded-lg bg-muted animate-pulse" />
              <div className="h-4 w-20 rounded bg-muted animate-pulse" />
            </div>
          ))}
        </div>
      </div>

      {/* Recent Outings skeleton */}
      <div className="space-y-3 pt-2">
        <div className="h-6 w-32 rounded-md bg-muted animate-pulse" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="flex gap-3 items-start py-3 border-b border-border last:border-0">
            <div className="h-4 w-4 rounded-full bg-muted animate-pulse mt-0.5" />
            <div className="flex-1 space-y-1.5">
              <div className="h-4 w-28 rounded bg-muted animate-pulse" />
              <div className="h-3 w-40 rounded bg-muted animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

export default function HomePage({ data, onAddPhotos, onAddPhotosIntent, onSelectOuting, onSelectSpecies, onNavigate }: HomePageProps) {
  const { outings, dex } = data

  const recentOutings = outings
    .slice()
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
    .slice(0, 5)
  const recentSpecies = dex
    .slice()
    .sort((a, b) => new Date(b.firstSeenDate).getTime() - new Date(a.firstSeenDate).getTime())
    .slice(0, 6)

  const thisMonth = new Date()
  const thisMonthStart = new Date(thisMonth.getFullYear(), thisMonth.getMonth(), 1)
  const newThisMonth = dex.filter(entry => {
    const dateStr = entry.addedDate || entry.firstSeenDate
    return new Date(dateStr) >= thisMonthStart
  }).length

  const totalPhotos = data.photos.length

  if (data.isLoading) {
    return (
      <div className="px-4 sm:px-6 pt-8 sm:pt-10 space-y-6">
        <HomeContentSkeleton />
      </div>
    )
  }

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
              WingDex. <em>Reverse birding</em> at its finest.
            </p>
          </div>
          <Button
            size="lg"
            onClick={onAddPhotos}
            onPointerDown={onAddPhotosIntent}
            onMouseEnter={onAddPhotosIntent}
            onFocus={onAddPhotosIntent}
            onTouchStart={onAddPhotosIntent}
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
      <div className="px-4 sm:px-6 pt-8 sm:pt-10 pb-4 max-w-3xl mx-auto">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-serif text-5xl sm:text-6xl font-semibold text-foreground tracking-tight leading-none">
              {dex.length}
            </p>
            <p className="font-serif text-lg sm:text-xl text-muted-foreground italic mt-1">
              species observed
            </p>
          </div>
          <button
            onClick={onAddPhotos}
            onPointerDown={onAddPhotosIntent}
            onMouseEnter={onAddPhotosIntent}
            onFocus={onAddPhotosIntent}
            onTouchStart={onAddPhotosIntent}
            className="inline-flex items-center gap-2.5 px-6 py-3 rounded-lg
              bg-gradient-to-r from-emerald-600 to-teal-500
              text-white text-base
              shadow-sm hover:brightness-105 active:scale-[0.97]
              transition-all duration-150 cursor-pointer flex-shrink-0"
          >
            <Camera size={18} weight="bold" />
            Add
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
                  onClick={() => onNavigate('wingdex')}
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
            className="w-full h-full object-cover object-[center_10%]"
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
