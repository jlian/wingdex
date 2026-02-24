import { memo } from 'react'
import { useBirdImage } from '@/hooks/use-bird-image'
import { WikiBirdThumbnail } from '@/components/ui/wiki-bird-thumbnail'
import { ListRow } from '@/components/ui/list-row'
import { getDisplayName, getScientificName } from '@/lib/utils'

interface BirdRowProps {
  speciesName: string
  /** Optional subtitle text below the name (e.g. "3 outings · 5 seen · Jan 1") */
  subtitle?: string
  onClick: () => void
  /** Optional right-side actions rendered after the row content */
  actions?: React.ReactNode
}

export const BirdRow = memo(function BirdRow({ speciesName, subtitle, onClick, actions }: BirdRowProps) {
  const displayName = getDisplayName(speciesName)
  const scientificName = getScientificName(speciesName)
  const wikiImage = useBirdImage(speciesName)

  return (
    <ListRow
      icon={
        <div className="py-1.5">
          <WikiBirdThumbnail
            speciesName={speciesName}
            imageUrl={wikiImage}
            alt={displayName}
            className="w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20"
          />
        </div>
      }
      onClick={onClick}
      actions={actions}
    >
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
      {subtitle && (
        <p className="text-xs text-muted-foreground mt-0.5">
          {subtitle}
        </p>
      )}
    </ListRow>
  )
})
