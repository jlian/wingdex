import { useState } from 'react'
import { BirdLogo } from '@/components/ui/bird-logo'
import { useBirdImage } from '@/hooks/use-bird-image'
import { cn } from '@/lib/utils'

// iOS Safari can repaint/flicker thumbnail layers during interactive back-swipe
// when images decode late; keep eager loading on iOS, lazy elsewhere.
const SHOULD_LAZY_LOAD_THUMBNAILS = (() => {
  if (typeof navigator === 'undefined') return true
  const userAgent = navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(userAgent)
    || (userAgent.includes('Mac') && navigator.maxTouchPoints > 1)
  return !isIOS
})()

interface WikiBirdThumbnailProps {
  /** Species name to fetch the Wikipedia thumbnail for */
  speciesName: string
  /** Optional pre-resolved image URL (skips the hook when provided) */
  imageUrl?: string
  /** When false, do not fallback to client-side Wikipedia lookup */
  allowLookup?: boolean
  /** Display name for the alt text */
  alt?: string
  /** Additional class names for the outer container */
  className?: string
  /** Show a pulsing placeholder while loading (default: false) */
  loading?: boolean
}

/**
 * Square Wikipedia bird thumbnail with portrait-aware cropping.
 * Tall (portrait) images anchor to the top so the bird's head stays visible.
 */
export function WikiBirdThumbnail({
  speciesName,
  imageUrl: imageUrlProp,
  allowLookup = true,
  alt,
  className,
  loading: externalLoading,
}: WikiBirdThumbnailProps) {
  const hookUrl = useBirdImage(imageUrlProp || !allowLookup ? undefined : speciesName)
  const url = imageUrlProp || hookUrl
  const [portrait, setPortrait] = useState(false)

  return (
    <div
      className={cn(
        'aspect-square rounded-lg overflow-hidden bg-muted/20',
        className,
      )}
    >
      {url ? (
        <img
          src={url}
          alt={alt ?? speciesName}
          loading={SHOULD_LAZY_LOAD_THUMBNAILS ? 'lazy' : 'eager'}
          onLoad={(e) => {
            const img = e.currentTarget
            setPortrait(img.naturalHeight > img.naturalWidth)
          }}
          className="w-full h-full object-cover"
          style={{ objectPosition: portrait ? 'center top' : 'center center' }}
        />
      ) : (
        <div
          className={cn(
            'w-full h-full flex items-center justify-center',
            externalLoading && 'animate-pulse',
          )}
        >
          <BirdLogo size={24} className="text-muted-foreground/40" />
        </div>
      )}
    </div>
  )
}
