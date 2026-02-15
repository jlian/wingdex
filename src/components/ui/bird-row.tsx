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
    <div className="flex items-center gap-3 px-2 border-b border-border rounded-lg hover:bg-muted/30 active:bg-muted transition-colors cursor-pointer" onClick={onClick}>
      {/* Thumbnail */}
      <button className="flex-shrink-0 cursor-pointer py-1.5" onClick={onClick} tabIndex={-1}>
        {image}
      </button>
      {/* Text + actions */}
      <div className="flex items-center flex-1 min-w-0 gap-2 py-3">
        <button
          className="flex-1 min-w-0 text-left cursor-pointer"
          onClick={onClick}
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
        </button>
        {actions}
      </div>
    </div>
  )
}
