import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  MagnifyingGlass, CalendarBlank, ArrowLeft, ArrowSquareOut,
  Bird, MapPin, Eye, Binoculars
} from '@phosphor-icons/react'
import { useBirdImage, useBirdSummary } from '@/hooks/use-bird-image'
import type { useBirdDexData } from '@/hooks/use-birddex-data'
import type { LifeListEntry, Observation } from '@/lib/types'

type SortKey = 'name' | 'recent' | 'count'

interface LifeListPageProps {
  data: ReturnType<typeof useBirdDexData>
  selectedSpecies: string | null
  onSelectSpecies: (name: string | null) => void
}

export default function LifeListPage({ data, selectedSpecies, onSelectSpecies }: LifeListPageProps) {
  const { lifeList } = data
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('recent')

  const sortedList = [...lifeList].sort((a, b) => {
    if (sortBy === 'name') return a.speciesName.localeCompare(b.speciesName)
    if (sortBy === 'count') return b.totalCount - a.totalCount
    // recent
    const aDate = a.addedDate || a.firstSeenDate
    const bDate = b.addedDate || b.firstSeenDate
    return new Date(bDate).getTime() - new Date(aDate).getTime()
  })

  const filteredList = sortedList.filter(entry =>
    entry.speciesName.toLowerCase().includes(searchQuery.toLowerCase())
  )

  if (lifeList.length === 0) {
    return (
      <div className="px-4 sm:px-6 py-16 text-center space-y-3 max-w-3xl mx-auto">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Bird size={32} className="text-primary" weight="duotone" />
          </div>
        </div>
        <p className="text-lg text-muted-foreground">Your life list is empty</p>
        <p className="text-sm text-muted-foreground">
          Upload photos and confirm species to start building your list
        </p>
      </div>
    )
  }

  if (selectedSpecies) {
    const entry = lifeList.find(e => e.speciesName === selectedSpecies)
    if (!entry) {
      // Don't call onSelectSpecies during render — return null gracefully
      return null
    }
    return (
      <SpeciesDetail
        entry={entry}
        data={data}
        onBack={() => onSelectSpecies(null)}
      />
    )
  }

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: 'recent', label: 'Recent' },
    { key: 'name', label: 'A-Z' },
    { key: 'count', label: 'Most seen' },
  ]

  return (
    <div className="px-4 sm:px-6 py-6 space-y-4 max-w-3xl mx-auto">
      <div className="space-y-1">
        <h2 className="font-serif text-2xl font-semibold text-foreground">
          Life List
        </h2>
        <p className="text-sm text-muted-foreground">
          {lifeList.length} species observed
        </p>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <MagnifyingGlass
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Search species..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <div className="flex items-center gap-1">
          {sortOptions.map(opt => (
            <Button
              key={opt.key}
              variant={sortBy === opt.key ? 'secondary' : 'ghost'}
              size="sm"
              className="text-xs h-9 px-2.5"
              onClick={() => setSortBy(opt.key)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="divide-y divide-border">
        {filteredList.map((entry, i) => (
          <SpeciesRow
            key={entry.speciesName}
            entry={entry}
            onClick={() => onSelectSpecies(entry.speciesName)}
          />
        ))}
      </div>

      {filteredList.length === 0 && searchQuery && (
        <div className="text-center py-8 text-muted-foreground">
          No species found matching "{searchQuery}"
        </div>
      )}
    </div>
  )
}

// ─── Species Row (compact list item) ──────────────────────

function SpeciesRow({
  entry,
  onClick,
}: {
  entry: LifeListEntry
  onClick: () => void
}) {
  const displayName = entry.speciesName.split('(')[0].trim()
  const scientificName = entry.speciesName.match(/\(([^)]+)\)/)?.[1]
  const wikiImage = useBirdImage(entry.speciesName)
  const dateStr = entry.addedDate || entry.firstSeenDate

  return (
    <button
      className="flex items-center gap-3 md:gap-4 py-2.5 w-full text-left rounded-md hover:bg-muted/50 transition-colors cursor-pointer active:bg-muted"
      onClick={onClick}
    >
      {wikiImage ? (
        <img
          src={wikiImage}
          alt={displayName}
          className="w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 rounded-lg object-cover bg-muted flex-shrink-0"
          loading="lazy"
        />
      ) : (
        <div className="w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
          <Bird size={20} className="text-muted-foreground/40" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="md:flex md:items-baseline md:gap-2">
          <p className="font-serif font-semibold text-sm text-foreground truncate">
            {displayName}
          </p>
          {scientificName && (
            <p className="text-xs text-muted-foreground italic truncate">
              {scientificName}
            </p>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {entry.totalOutings} {entry.totalOutings === 1 ? 'outing' : 'outings'} · {entry.totalCount} seen · {new Date(dateStr).toLocaleDateString()}
        </p>
      </div>
    </button>
  )
}

// ─── Species Detail View ──────────────────────────────────

function SpeciesDetail({
  entry,
  data,
  onBack,
}: {
  entry: LifeListEntry
  data: ReturnType<typeof useBirdDexData>
  onBack: () => void
}) {
  const displayName = entry.speciesName.split('(')[0].trim()
  const scientificName = entry.speciesName.match(/\(([^)]+)\)/)?.[1]
  const wikiImage = useBirdImage(entry.speciesName)
  const { summary, loading: summaryLoading } = useBirdSummary(entry.speciesName)

  // Find all sightings of this species across outings
  const sightings: Array<{ observation: Observation; outing: { locationName: string; startTime: string } }> = []
  for (const outing of data.outings) {
    const obs = data.getOutingObservations(outing.id)
    for (const o of obs) {
      if (o.speciesName === entry.speciesName && o.certainty !== 'rejected') {
        sightings.push({ observation: o, outing: { locationName: outing.locationName, startTime: outing.startTime } })
      }
    }
  }

  const ebirdUrl = `https://ebird.org/explore?q=${encodeURIComponent(displayName)}`
  const heroImage = summary?.imageUrl || wikiImage

  return (
    <div className="max-w-3xl mx-auto pb-8">
      {/* Back button */}
      <div className="px-4 sm:px-6 py-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
          <ArrowLeft size={18} className="mr-1" />
          Life List
        </Button>
      </div>

      {/* Hero image */}
      {summaryLoading ? (
        <div className="w-full h-48 sm:h-64 lg:h-80 bg-muted animate-pulse" />
      ) : heroImage ? (
        <div className="relative w-full h-48 sm:h-64 lg:h-80 bg-muted overflow-hidden">
          <img
            src={heroImage}
            alt={displayName}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 px-4 sm:px-6 pb-4">
            <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-white drop-shadow-lg">
              {displayName}
            </h2>
            {scientificName && (
              <p className="text-sm sm:text-base text-white/80 italic drop-shadow-md">
                {scientificName}
              </p>
            )}
          </div>
        </div>
      ) : null}

      <div className="px-4 sm:px-6 space-y-5 mt-4">
        {/* Name — only show if no hero image */}
        {!heroImage && !summaryLoading && (
          <div>
            <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-foreground">
              {displayName}
            </h2>
            {scientificName && (
              <p className="text-base text-muted-foreground italic mt-1">
                {scientificName}
              </p>
            )}
          </div>
        )}

        {/* Stat cards */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="p-3 text-center">
            <Eye size={18} className="text-primary mx-auto mb-1" />
            <p className="text-xl font-semibold text-foreground">{entry.totalCount}</p>
            <p className="text-xs text-muted-foreground">Total Seen</p>
          </Card>
          <Card className="p-3 text-center">
            <Binoculars size={18} className="text-primary mx-auto mb-1" />
            <p className="text-xl font-semibold text-foreground">{entry.totalOutings}</p>
            <p className="text-xs text-muted-foreground">{entry.totalOutings === 1 ? 'Outing' : 'Outings'}</p>
          </Card>
          <Card className="p-3 text-center">
            <CalendarBlank size={18} className="text-primary mx-auto mb-1" />
            <p className="text-xl font-semibold text-foreground">
              {new Date(entry.firstSeenDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </p>
            <p className="text-xs text-muted-foreground">First Seen</p>
          </Card>
        </div>

        {/* About */}
        <div className="space-y-2">
          <h3 className="font-semibold text-foreground">About</h3>
          {summaryLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-4/6" />
            </div>
          ) : summary?.extract ? (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {summary.extract}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No description available
            </p>
          )}
        </div>

        {/* External links */}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={ebirdUrl} target="_blank" rel="noopener noreferrer">
              <ArrowSquareOut size={14} className="mr-1.5" />
              eBird
            </a>
          </Button>
          {summary?.pageUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={summary.pageUrl} target="_blank" rel="noopener noreferrer">
                <ArrowSquareOut size={14} className="mr-1.5" />
                Wikipedia
              </a>
            </Button>
          )}
          <Button variant="outline" size="sm" asChild>
            <a
              href={`https://www.allaboutbirds.org/guide/${encodeURIComponent(displayName.replace(/ /g, '_'))}`}
              target="_blank" rel="noopener noreferrer"
            >
              <ArrowSquareOut size={14} className="mr-1.5" />
              All About Birds
            </a>
          </Button>
        </div>

        {/* Sighting history */}
        {sightings.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-semibold text-foreground">
              Sighting History ({sightings.length})
            </h3>
            <Card className="divide-y divide-border overflow-hidden">
              {sightings.map(({ observation, outing }) => (
                <div key={observation.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <MapPin size={16} className="text-primary" weight="fill" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {outing.locationName || 'Unknown location'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(outing.startTime).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                      {observation.count > 1 && (
                        <span className="ml-1.5">x{observation.count}</span>
                      )}
                    </p>
                  </div>
                  <Badge
                    variant={observation.certainty === 'confirmed' ? 'secondary' : 'outline'}
                    className="text-[10px] flex-shrink-0"
                  >
                    {observation.certainty}
                  </Badge>
                </div>
              ))}
            </Card>
          </div>
        )}

        {/* Notes */}
        {entry.notes && (
          <div className="space-y-2">
            <h3 className="font-semibold text-foreground">Notes</h3>
            <p className="text-sm text-muted-foreground italic">{entry.notes}</p>
          </div>
        )}
      </div>
    </div>
  )
}
