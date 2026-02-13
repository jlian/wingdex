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

  return (
    <div className="flex items-center gap-3 md:gap-4 py-2.5 hover:bg-muted/50 transition-colors">
      <button
        className="flex items-center gap-3 md:gap-4 flex-1 min-w-0 text-left cursor-pointer"
        onClick={onClick}
      >
        {wikiImage ? (
          <img
            src={wikiImage}
            alt={displayName}
            className="w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 rounded-lg object-cover bg-muted flex-shrink-0"
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
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
      </button>
      {actions}
    </div>
  )
}
