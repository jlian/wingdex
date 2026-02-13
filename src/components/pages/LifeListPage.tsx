import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  MagnifyingGlass, CalendarBlank, ArrowLeft, ArrowSquareOut,
  Bird, MapPin
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
      <div className="px-4 sm:px-6 py-16 text-center space-y-3">
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
      onSelectSpecies(null)
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
    <div className="px-4 sm:px-6 py-4 space-y-3">
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
            index={i}
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
  index = 0,
  onClick,
}: {
  entry: LifeListEntry
  index?: number
  onClick: () => void
}) {
  const displayName = entry.speciesName.split('(')[0].trim()
  const scientificName = entry.speciesName.match(/\(([^)]+)\)/)?.[1]
  const wikiImage = useBirdImage(entry.speciesName)
  const dateStr = entry.addedDate || entry.firstSeenDate

  return (
    <button
      className={`flex items-center gap-3 py-2.5 w-full text-left hover:bg-muted/50 transition-colors cursor-pointer active:bg-muted animate-card-in stagger-${Math.min(index + 1, 18)}`}
      onClick={onClick}
    >
      <div className="flex-1 min-w-0">
        <p className="font-serif font-semibold text-sm text-foreground truncate">
          {displayName}
        </p>
        {scientificName && (
          <p className="text-xs text-muted-foreground italic truncate">
            {scientificName}
          </p>
        )}
        <p className="text-xs text-muted-foreground mt-0.5">
          {entry.totalOutings} {entry.totalOutings === 1 ? 'outing' : 'outings'} · {entry.totalCount} seen · {new Date(dateStr).toLocaleDateString()}
        </p>
      </div>
      {wikiImage ? (
        <img
          src={wikiImage}
          alt={displayName}
          className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg object-cover bg-muted flex-shrink-0"
          loading="lazy"
        />
      ) : (
        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
          <Bird size={20} className="text-muted-foreground/40" />
        </div>
      )}
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

  const ebirdSearchUrl = `https://ebird.org/species/${encodeURIComponent(
    (scientificName || displayName).replace(/ /g, '_').toLowerCase()
  )}`
  // Better eBird link: search by common name
  const ebirdUrl = `https://ebird.org/explore?q=${encodeURIComponent(displayName)}`

  return (
    <div className="max-w-4xl mx-auto pb-8 animate-fade-in">
      {/* Header */}
      <div className="px-4 sm:px-6 py-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="mb-3 -ml-2">
          <ArrowLeft size={18} className="mr-1" />
          Life List
        </Button>
      </div>

      {/* Hero image */}
      {summaryLoading ? (
        <div className="w-full h-48 sm:h-64 lg:h-80 bg-muted animate-pulse" />
      ) : (summary?.imageUrl || wikiImage) ? (
        <div className="w-full h-48 sm:h-64 lg:h-80 bg-muted overflow-hidden">
          <img
            src={summary?.imageUrl || wikiImage}
            alt={displayName}
            className="w-full h-full object-cover"
          />
        </div>
      ) : null}

      <div className="px-4 sm:px-6 space-y-4 mt-4">
        {/* Name + badges */}
        <div className="space-y-2">
          <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-foreground">
            {displayName}
          </h2>
          {scientificName && (
            <p className="text-base text-muted-foreground italic">
              {scientificName}
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Badge variant="secondary">
              {entry.totalCount} total observed
            </Badge>
            <Badge variant="secondary">
              {entry.totalOutings} {entry.totalOutings === 1 ? 'outing' : 'outings'}
            </Badge>
            <Badge variant="outline" className="text-xs">
              <CalendarBlank size={12} className="mr-1" />
              First seen {new Date(entry.firstSeenDate).toLocaleDateString()}
            </Badge>
          </div>
        </div>

        {/* Wikipedia description */}
        <div className="space-y-3">
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
            <div className="space-y-2">
              {sightings.map(({ observation, outing }) => (
                <Card key={observation.id} className="p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <CalendarBlank size={14} className="text-muted-foreground flex-shrink-0" />
                      <span className="text-foreground">
                        {new Date(outing.startTime).toLocaleDateString()}
                      </span>
                      {observation.count > 1 && (
                        <Badge variant="outline" className="text-[10px]">
                          ×{observation.count}
                        </Badge>
                      )}
                    </div>
                    {outing.locationName && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        <MapPin size={12} className="flex-shrink-0" />
                        <span className="truncate">{outing.locationName}</span>
                      </div>
                    )}
                  </div>
                  <Badge
                    variant={observation.certainty === 'confirmed' ? 'secondary' : 'outline'}
                    className="text-[10px] flex-shrink-0"
                  >
                    {observation.certainty}
                  </Badge>
                </Card>
              ))}
            </div>
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
