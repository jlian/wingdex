import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  MagnifyingGlass, CalendarBlank, ArrowLeft, ArrowSquareOut,
  Bird, ArrowUp, ArrowDown
} from '@phosphor-icons/react'
import { useBirdImage, useBirdSummary } from '@/hooks/use-bird-image'
import { BirdRow } from '@/components/ui/bird-row'
import { EmptyState } from '@/components/ui/empty-state'
import { getDisplayName, getScientificName } from '@/lib/utils'
import { getEbirdUrl } from '@/lib/taxonomy'
import type { BirdDexDataStore } from '@/hooks/use-birddex-data'
import type { DexEntry, Observation } from '@/lib/types'

type SortField = 'date' | 'count' | 'name'
type SortDir = 'asc' | 'desc'

interface BirdDexPageProps {
  data: BirdDexDataStore
  selectedSpecies: string | null
  onSelectSpecies: (name: string | null) => void
  onSelectOuting: (id: string) => void
}

export default function BirdDexPage({ data, selectedSpecies, onSelectSpecies, onSelectOuting }: BirdDexPageProps) {
  const { dex } = data
  const [searchQuery, setSearchQuery] = useState('')
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir(field === 'name' ? 'asc' : 'desc')
    }
  }

  const sortedList = [...dex].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    if (sortField === 'name') return dir * a.speciesName.localeCompare(b.speciesName)
    if (sortField === 'count') return dir * (a.totalCount - b.totalCount)
    // date (default) — first seen
    return dir * (new Date(a.firstSeenDate).getTime() - new Date(b.firstSeenDate).getTime())
  })

  const filteredList = sortedList.filter(entry =>
    entry.speciesName.toLowerCase().includes(searchQuery.toLowerCase())
  )

  if (dex.length === 0) {
    return (
      <EmptyState
        icon={Bird}
        title="Your BirdDex is empty"
        description="Upload photos and confirm species to start building your BirdDex"
      />
    )
  }

  if (selectedSpecies) {
    const entry = dex.find(e => e.speciesName === selectedSpecies)
    if (!entry) {
      // Don't call onSelectSpecies during render — return null gracefully
      return null
    }
    return (
      <SpeciesDetail
        entry={entry}
        data={data}
        onBack={() => window.history.back()}
        onSelectOuting={onSelectOuting}
      />
    )
  }

  const sortOptions: { key: SortField; label: string }[] = [
    { key: 'date', label: 'Date' },
    { key: 'count', label: 'Count' },
    { key: 'name', label: 'A-Z' },
  ]

  return (
    <div className="px-4 sm:px-6 py-6 space-y-4 max-w-3xl mx-auto">
      <div className="space-y-1">
        <h2 className="font-serif text-2xl font-semibold text-foreground">
          BirdDex
        </h2>
        <p className="text-sm text-muted-foreground">
          {dex.length} species observed
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
          {sortOptions.map(opt => {
            const isActive = sortField === opt.key
            const DirIcon = sortDir === 'asc' ? ArrowUp : ArrowDown
            return (
              <Button
                key={opt.key}
                variant={isActive ? 'secondary' : 'ghost'}
                size="sm"
                className="text-xs h-9 px-2.5"
                onClick={() => toggleSort(opt.key)}
              >
                {opt.label}
                {isActive && <DirIcon size={12} className="ml-0.5" />}
              </Button>
            )
          })}
        </div>
      </div>

      <div>
        {filteredList.map((entry) => {
          return (
            <BirdRow
              key={entry.speciesName}
              speciesName={entry.speciesName}
              subtitle={`${entry.totalOutings} ${entry.totalOutings === 1 ? 'outing' : 'outings'} · ${entry.totalCount} seen · ${new Date(entry.firstSeenDate).toLocaleDateString()}`}
              onClick={() => onSelectSpecies(entry.speciesName)}
            />
          )
        })}
      </div>

      {filteredList.length === 0 && searchQuery && (
        <div className="text-center py-8 text-muted-foreground">
          No species found matching "{searchQuery}"
        </div>
      )}
    </div>
  )
}

// ─── Species Detail View ──────────────────────────────────

function SpeciesDetail({
  entry,
  data,
  onBack,
  onSelectOuting,
}: {
  entry: DexEntry
  data: BirdDexDataStore
  onBack: () => void
  onSelectOuting: (id: string) => void
}) {
  const displayName = getDisplayName(entry.speciesName)
  const scientificName = getScientificName(entry.speciesName)
  const wikiImage = useBirdImage(entry.speciesName)
  const { summary, loading: summaryLoading } = useBirdSummary(entry.speciesName)

  // Find all sightings of this species across outings
  const sightings: Array<{ observation: Observation; outing: { id: string; locationName: string; startTime: string } }> = []
  for (const outing of data.outings) {
    const obs = data.getOutingObservations(outing.id)
    for (const o of obs) {
      if (o.speciesName === entry.speciesName && o.certainty !== 'rejected') {
        sightings.push({ observation: o, outing: { id: outing.id, locationName: outing.locationName, startTime: outing.startTime } })
      }
    }
  }

  const ebirdUrl = getEbirdUrl(displayName)
  const heroImage = summary?.imageUrl || wikiImage

  return (
    <div className="max-w-3xl mx-auto pb-8 animate-fade-in">
      {/* Back button */}
      <div className="px-4 sm:px-6 pt-4 pb-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
          <ArrowLeft size={20} />
          Your BirdDex
        </Button>
      </div>

      <div className="px-4 sm:px-6 space-y-6">
        {/* Hero: image + name + stats */}
        <div className="flex gap-5 sm:gap-6">
          {/* Square image */}
          {summaryLoading ? (
            <Skeleton className="w-32 h-32 sm:w-40 sm:h-40 rounded-xl flex-shrink-0" />
          ) : heroImage ? (
            <div className="w-32 h-32 sm:w-40 sm:h-40 rounded-xl bg-muted overflow-hidden flex-shrink-0 shadow-sm">
              <img
                src={heroImage}
                alt={displayName}
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className="w-32 h-32 sm:w-40 sm:h-40 rounded-xl bg-muted flex-shrink-0 flex items-center justify-center">
              <Bird size={32} className="text-muted-foreground/40" />
            </div>
          )}

          {/* Name + inline stats */}
          <div className="min-w-0 flex-1 flex flex-col justify-center">
            {summaryLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-7 w-40" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-44 mt-2" />
              </div>
            ) : (
              <>
                <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-foreground leading-tight">
                  {displayName}
                </h2>
                {scientificName && (
                  <p className="text-sm text-muted-foreground italic mt-1">
                    {scientificName}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3.5 text-sm text-muted-foreground">
                  <span>
                    <span className="font-semibold text-foreground">{entry.totalCount}</span> seen
                  </span>
                  <span className="text-border">·</span>
                  <span>
                    <span className="font-semibold text-foreground">{entry.totalOutings}</span> {entry.totalOutings === 1 ? 'outing' : 'outings'}
                  </span>
                  <span className="text-border">·</span>
                  <span>
                    First <span className="font-semibold text-foreground">{new Date(entry.firstSeenDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* About */}
        {summaryLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
          </div>
        ) : summary?.extract ? (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground leading-relaxed">
              {summary.extract}
            </p>
            <p className="text-xs text-muted-foreground/60">
              Source: <a href={summary.pageUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-muted-foreground">Wikipedia</a>. Text and images available under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer" className="underline hover:text-muted-foreground">CC BY-SA 4.0</a>.
            </p>
          </div>
        ) : null}

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
          <div className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Sightings ({sightings.length})
            </h3>
            <div>
              {sightings.map(({ observation, outing }) => (
                <button
                  key={observation.id}
                  className="flex w-full items-center gap-3 px-2 text-left cursor-pointer"
                  onClick={() => onSelectOuting(outing.id)}
                >
                  <CalendarBlank size={16} className="text-muted-foreground/60 flex-shrink-0" />
                  <div className="flex-1 min-w-0 border-b border-border py-2.5">
                    <p className="text-sm font-medium text-foreground truncate">
                      {outing.locationName || 'Unknown location'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(outing.startTime).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                      {observation.count > 1 && ` · x${observation.count}`}
                      {' · '}
                      {observation.certainty.charAt(0).toUpperCase() + observation.certainty.slice(1)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        {entry.notes && (
          <div className="space-y-1.5">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Notes</h3>
            <p className="text-sm text-muted-foreground italic">{entry.notes}</p>
          </div>
        )}
      </div>
    </div>
  )
}
