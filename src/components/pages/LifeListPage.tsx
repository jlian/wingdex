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

interface LifeListPageProps {
  data: ReturnType<typeof useBirdDexData>
}

export default function LifeListPage({ data }: LifeListPageProps) {
  const { lifeList } = data
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSpecies, setSelectedSpecies] = useState<string | null>(null)

  const filteredList = lifeList.filter(entry =>
    entry.speciesName.toLowerCase().includes(searchQuery.toLowerCase())
  )

  if (lifeList.length === 0) {
    return (
      <div className="px-4 sm:px-6 py-16 text-center space-y-3 max-w-2xl mx-auto">
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
      setSelectedSpecies(null)
      return null
    }
    return (
      <SpeciesDetail
        entry={entry}
        data={data}
        onBack={() => setSelectedSpecies(null)}
      />
    )
  }

  return (
    <div className="px-4 sm:px-6 py-6 space-y-5 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-serif text-2xl font-semibold text-foreground">
            Life List
          </h2>
          <p className="text-sm text-muted-foreground">
            {lifeList.length} species observed
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <MagnifyingGlass
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Search species..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredList.map(entry => (
          <SpeciesCard
            key={entry.speciesName}
            entry={entry}
            onClick={() => setSelectedSpecies(entry.speciesName)}
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

// ─── Species Card (grid item) ─────────────────────────────

function SpeciesCard({
  entry,
  onClick,
}: {
  entry: LifeListEntry
  onClick: () => void
}) {
  const displayName = entry.speciesName.split('(')[0].trim()
  const scientificName = entry.speciesName.match(/\(([^)]+)\)/)?.[1]
  const wikiImage = useBirdImage(entry.speciesName)

  return (
    <Card
      className="flex gap-3 p-3 hover:shadow-md transition-shadow cursor-pointer active:scale-[0.99] group"
      onClick={onClick}
    >
      {wikiImage ? (
        <img
          src={wikiImage}
          alt={displayName}
          className="w-16 h-16 sm:w-20 sm:h-20 object-cover rounded bg-muted flex-shrink-0 group-hover:scale-105 transition-transform duration-200"
          loading="lazy"
        />
      ) : (
        <div className="w-16 h-16 sm:w-20 sm:h-20 bg-muted rounded flex items-center justify-center flex-shrink-0">
          <Bird size={24} className="text-muted-foreground/40" />
        </div>
      )}

      <div className="flex-1 min-w-0 space-y-1">
        <h3 className="font-serif font-semibold text-foreground text-sm truncate">
          {displayName}
        </h3>
        {scientificName && (
          <p className="text-xs text-muted-foreground italic truncate">
            {scientificName}
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary" className="text-[10px] px-1.5">
            {entry.totalOutings} {entry.totalOutings === 1 ? 'outing' : 'outings'}
          </Badge>
          <Badge variant="secondary" className="text-[10px] px-1.5">
            {entry.totalCount} seen
          </Badge>
        </div>
      </div>
    </Card>
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
    <div className="max-w-3xl mx-auto pb-8">
      {/* Header */}
      <div className="px-4 sm:px-6 py-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="mb-3 -ml-2">
          <ArrowLeft size={18} className="mr-1" />
          Life List
        </Button>
      </div>

      {/* Hero image */}
      {(wikiImage || summary?.imageUrl) && (
        <div className="w-full h-48 sm:h-64 lg:h-80 bg-muted overflow-hidden">
          <img
            src={summary?.imageUrl || wikiImage}
            alt={displayName}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      <div className="px-4 sm:px-6 space-y-6 mt-5">
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
