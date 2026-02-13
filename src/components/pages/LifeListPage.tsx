import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { MagnifyingGlass, CalendarBlank } from '@phosphor-icons/react'
import { useBirdImage } from '@/hooks/use-bird-image'
import type { useBirdDexData } from '@/hooks/use-birddex-data'

interface LifeListPageProps {
  data: ReturnType<typeof useBirdDexData>
}

export default function LifeListPage({ data }: LifeListPageProps) {
  const { lifeList } = data
  const [searchQuery, setSearchQuery] = useState('')

  const filteredList = lifeList.filter(entry =>
    entry.speciesName.toLowerCase().includes(searchQuery.toLowerCase())
  )

  if (lifeList.length === 0) {
    return (
      <div className="p-4 py-16 text-center space-y-2">
        <p className="text-lg text-muted-foreground">Your life list is empty</p>
        <p className="text-sm text-muted-foreground">
          Add photos and confirm species to build your list
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold text-foreground">
          Life List
        </h2>
        <div className="text-sm text-muted-foreground">
          {lifeList.length} species observed
        </div>
      </div>

      <div className="relative">
        <MagnifyingGlass
          size={20}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          placeholder="Search species..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      <div className="space-y-2">
        {filteredList.map(entry => {
          const photo = entry.bestPhotoId
            ? data.photos.find(p => p.id === entry.bestPhotoId)
            : null

          const displayName = entry.speciesName.split('(')[0].trim()
          const scientificName = entry.speciesName.match(/\(([^)]+)\)/)?.[1]

          return (
            <Card
              key={entry.speciesName}
              className="flex gap-3 p-3 hover:shadow-md transition-shadow"
            >
              <SpeciesImage
                speciesName={entry.speciesName}
                storedThumbnail={photo?.thumbnail}
                displayName={displayName}
              />

              <div className="flex-1 space-y-1">
                <h3 className="font-serif font-semibold text-foreground">
                  {displayName}
                </h3>
                {scientificName && (
                  <p className="text-xs text-muted-foreground italic">
                    {scientificName}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <CalendarBlank size={14} />
                    First: {new Date(entry.firstSeenDate).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {entry.totalOutings} {entry.totalOutings === 1 ? 'outing' : 'outings'}
                  </Badge>
                  <Badge variant="secondary" className="text-xs">
                    {entry.totalCount} seen
                  </Badge>
                </div>
              </div>
            </Card>
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

function SpeciesImage({
  speciesName,
  storedThumbnail,
  displayName,
}: {
  speciesName: string
  storedThumbnail?: string
  displayName: string
}) {
  const wikiImage = useBirdImage(speciesName)

  // Prefer stored photo, fall back to Wikipedia, then emoji
  const src = storedThumbnail || wikiImage
  if (src) {
    return (
      <img
        src={src}
        alt={displayName}
        className="w-20 h-20 object-cover rounded bg-muted"
        loading="lazy"
      />
    )
  }

  return (
    <div className="w-20 h-20 bg-muted rounded flex items-center justify-center">
      <span className="text-2xl">🐦</span>
    </div>
  )
}
