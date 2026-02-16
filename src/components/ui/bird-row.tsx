import { Bird } from '@phosphor-icons/react'
import { useBirdImage } from '@/hooks/use-bird-image'
import { getDisplayName, getScientificName } from '@/lib/utils'

interface BirdRowProps {
  speciesName: string
  /** Optional subtitle text below the name (e.g. "3 outings · 5 seen · Jan 1") */
  subtitle?: string
  onClick: () => void
  /** Optional right-side actions rendered after the row content */
  actions?: React.ReactNode
}

export function BirdRow({ speciesName, subtitle, onClick, actions }: BirdRowProps) {
  const displayName = getDisplayName(speciesName)
  const scientificName = getScientificName(speciesName)
  const wikiImage = useBirdImage(speciesName)

  const image = wikiImage ? (
    <img
      src={wikiImage}
      alt={displayName}
      className="w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 rounded-lg object-cover bg-muted flex-shrink-0"
    />
  ) : (
    <div className="w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
      <Bird size={20} className="text-muted-foreground/40" />
    </div>
  )

  return (
    <div
      role="button"
      tabIndex={0}
      className="flex items-stretch gap-3 px-2 rounded-lg hover:bg-muted/30 active:bg-muted transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={(event) => {
        // Ignore clicks on nested interactive elements (e.g. action buttons)
        if ((event.target as HTMLElement).closest('button, a, [role="button"]') !== event.currentTarget) return
        onClick()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          // Ignore keypresses originating from nested interactive elements
          if ((event.target as HTMLElement).closest('button, a, [role="button"]') !== event.currentTarget) return
          event.preventDefault()
          onClick()
        }
      }}
    >
      {/* Thumbnail */}
      <div className="flex-shrink-0 flex items-center py-1.5">
        {image}
      </div>
      {/* Text + actions — inset bottom border, stretches to row height */}
      <div className="flex items-center flex-1 min-w-0 gap-2 border-b border-border py-3">
        <div className="flex-1 min-w-0 text-left">
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
        </div>
        {actions}
      </div>
    </div>
  )
}
