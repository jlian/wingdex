import { useEffect, useMemo, useRef, useState } from 'react'
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
import { formatStoredDate } from '@/lib/timezone'
import type { WingDexDataStore } from '@/hooks/use-wingdex-data'
import type { DexEntry, Observation } from '@/lib/types'

export type SortField = 'date' | 'count' | 'name'
export type SortDir = 'asc' | 'desc'

const INITIAL_VISIBLE_ITEMS = 40
const LOAD_MORE_STEP = 40

interface WingDexPageProps {
  data: WingDexDataStore
  selectedSpecies: string | null
  onSelectSpecies: (name: string | null) => void
  onSelectOuting: (id: string) => void
  searchQuery?: string
  onSearchQueryChange?: (value: string) => void
  sortField?: SortField
  sortDir?: SortDir
  onToggleSort?: (field: SortField) => void
}

export default function WingDexPage({
  data,
  selectedSpecies,
  onSelectSpecies,
  onSelectOuting,
  searchQuery,
  onSearchQueryChange,
  sortField,
  sortDir,
  onToggleSort,
}: WingDexPageProps) {
  const { dex } = data
  const [internalSearchQuery, setInternalSearchQuery] = useState('')
  const [internalSortField, setInternalSortField] = useState<SortField>('date')
  const [internalSortDir, setInternalSortDir] = useState<SortDir>('desc')
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_ITEMS)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const visibleCountRef = useRef(visibleCount)

  useEffect(() => {
    visibleCountRef.current = visibleCount
  }, [visibleCount])

  const effectiveSearchQuery = searchQuery ?? internalSearchQuery
  const effectiveSortField = sortField ?? internalSortField
  const effectiveSortDir = sortDir ?? internalSortDir

  const handleSearchQueryChange = (value: string) => {
    if (onSearchQueryChange) {
      onSearchQueryChange(value)
      return
    }
    setInternalSearchQuery(value)
  }

  const handleToggleSort = (field: SortField) => {
    if (onToggleSort) {
      onToggleSort(field)
      return
    }

    if (effectiveSortField === field) {
      setInternalSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
      return
    }

    setInternalSortField(field)
    setInternalSortDir(field === 'name' ? 'asc' : 'desc')
  }

  const sortedList = useMemo(() => {
    return [...dex].sort((a, b) => {
      const dir = effectiveSortDir === 'asc' ? 1 : -1
      if (effectiveSortField === 'name') return dir * a.speciesName.localeCompare(b.speciesName)
      if (effectiveSortField === 'count') return dir * (a.totalCount - b.totalCount)
      return dir * (new Date(a.firstSeenDate).getTime() - new Date(b.firstSeenDate).getTime())
    })
  }, [dex, effectiveSortDir, effectiveSortField])

  const filteredList = useMemo(() => {
    const query = effectiveSearchQuery.toLowerCase()
    return sortedList.filter(entry => entry.speciesName.toLowerCase().includes(query))
  }, [sortedList, effectiveSearchQuery])

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_ITEMS)
  }, [effectiveSearchQuery, effectiveSortField, effectiveSortDir])

  const visibleList = useMemo(
    () => filteredList.slice(0, visibleCount),
    [filteredList, visibleCount]
  )
  const hasMore = visibleCount < filteredList.length

  useEffect(() => {
    const node = loadMoreRef.current
    if (!node || !hasMore) return

    const maybeLoadMore = () => {
      if (node.getBoundingClientRect().top > window.innerHeight + 240) return
      if (visibleCountRef.current >= filteredList.length) return
      setVisibleCount((count) => {
        const nextCount = Math.min(count + LOAD_MORE_STEP, filteredList.length)
        visibleCountRef.current = nextCount
        return nextCount
      })
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        maybeLoadMore()
      },
      { rootMargin: '240px 0px' }
    )

    observer.observe(node)
    const rafId = requestAnimationFrame(maybeLoadMore)
    window.addEventListener('scroll', maybeLoadMore, { passive: true })
    window.addEventListener('resize', maybeLoadMore, { passive: true })

    return () => {
      observer.disconnect()
      cancelAnimationFrame(rafId)
      window.removeEventListener('scroll', maybeLoadMore)
      window.removeEventListener('resize', maybeLoadMore)
    }
  }, [filteredList.length, hasMore])

  if (dex.length === 0) {
    return (
      <EmptyState
        icon={Bird}
        title="Your WingDex is empty"
        description="Upload photos and confirm species to start building your WingDex"
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
    <div className="px-4 sm:px-6 py-6 space-y-4 max-w-3xl mx-auto animate-fade-in">
      <div className="space-y-1">
        <h2 className="font-serif text-2xl font-semibold text-foreground">
          WingDex
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
            value={effectiveSearchQuery}
            onChange={e => handleSearchQueryChange(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <div className="flex items-center gap-1">
          {sortOptions.map(opt => {
            const isActive = effectiveSortField === opt.key
            const DirIcon = effectiveSortDir === 'asc' ? ArrowUp : ArrowDown
            return (
              <Button
                key={opt.key}
                variant={isActive ? 'secondary' : 'ghost'}
                size="sm"
                className="text-xs h-9 px-2.5"
                onClick={() => handleToggleSort(opt.key)}
              >
                {opt.label}
                {isActive && <DirIcon size={12} className="ml-0.5" />}
              </Button>
            )
          })}
        </div>
      </div>

      <div>
        {visibleList.map((entry) => {
          return (
            <BirdRow
              key={entry.speciesName}
              speciesName={entry.speciesName}
              subtitle={`${entry.totalOutings} ${entry.totalOutings === 1 ? 'outing' : 'outings'} · ${entry.totalCount} seen · ${formatStoredDate(entry.firstSeenDate)}`}
              onClick={() => onSelectSpecies(entry.speciesName)}
            />
          )
        })}
      </div>

      {hasMore && (
        <div className="py-2">
          <div ref={loadMoreRef} className="h-1" />
          <p className="text-center text-xs text-muted-foreground">
            Loading more… ({filteredList.length - visibleList.length} remaining)
          </p>
        </div>
      )}

      {filteredList.length === 0 && effectiveSearchQuery && (
        <div className="text-center py-8 text-muted-foreground">
          No species found matching "{effectiveSearchQuery}"
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
  data: WingDexDataStore
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
          Back
        </Button>
      </div>

      <div className="px-4 sm:px-6 space-y-6">
        {/* Hero: full-width image with overlaid name + stats */}
        <div className="w-full aspect-[4/3] rounded-xl bg-muted overflow-hidden shadow-sm relative">
          {heroImage ? (
            <img
              src={heroImage}
              alt={displayName}
              className="absolute inset-0 w-full h-full object-cover object-[center_10%] animate-fade-in"
            />
          ) : !summaryLoading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Bird size={48} className="text-muted-foreground/40" />
            </div>
          ) : null}

          {/* Gradient overlay + text at bottom */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent pt-16 pb-4 px-4 sm:px-5">
            <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-white leading-tight drop-shadow-md">
              {displayName}
            </h2>
            {scientificName && (
              <p className="text-sm text-white/75 italic mt-0.5 drop-shadow-sm">{scientificName}</p>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-sm text-white/70">
              <span><span className="font-semibold text-white">{entry.totalCount}</span> seen</span>
              <span className="text-white/40">·</span>
              <span><span className="font-semibold text-white">{entry.totalOutings}</span> {entry.totalOutings === 1 ? 'outing' : 'outings'}</span>
              <span className="text-white/40">·</span>
              <span>First <span className="font-semibold text-white">{formatStoredDate(entry.firstSeenDate, { month: 'short', day: 'numeric', year: 'numeric' })}</span></span>
            </div>
          </div>
        </div>

        {/* About — crossfade from skeleton to content */}
        <div className="crossfade">
          <div className={`space-y-2 ${summaryLoading ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
          </div>
          {summary?.extract && (
            <div className={`space-y-1 ${summaryLoading ? 'opacity-0' : 'opacity-100'}`}>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {summary.extract}
            </p>
            <p className="text-xs text-muted-foreground/60">
              Source: <a href={summary.pageUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-muted-foreground">Wikipedia</a>. Text and images available under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer" className="underline hover:text-muted-foreground">CC BY-SA 4.0</a>.
            </p>
            </div>
          )}
        </div>

        {/* External links */}
        <div className="flex flex-wrap gap-2">
          {summary?.pageUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={summary.pageUrl} target="_blank" rel="noopener noreferrer">
                <ArrowSquareOut size={14} className="mr-1.5" />
                Wikipedia
              </a>
            </Button>
          )}
          <Button variant="outline" size="sm" asChild>
            <a href={ebirdUrl} target="_blank" rel="noopener noreferrer">
              <ArrowSquareOut size={14} className="mr-1.5" />
              eBird
            </a>
          </Button>
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
                  className="flex w-full items-center gap-3 px-2 rounded-lg text-left cursor-pointer hover:bg-muted/30 active:bg-muted transition-colors"
                  onClick={() => onSelectOuting(outing.id)}
                >
                  <CalendarBlank size={16} className="text-muted-foreground/60 flex-shrink-0" />
                  <div className="flex-1 min-w-0 border-b border-border py-3">
                    <p className="text-sm font-medium text-foreground truncate">
                      {outing.locationName || 'Unknown location'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatStoredDate(outing.startTime, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
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
