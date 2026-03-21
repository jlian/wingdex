import { useState, useCallback, useRef } from 'react'
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
  /** Additional gallery image URLs to cycle through on tap */
  galleryUrls?: string[]
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
 * When galleryUrls are provided, tap/swipe cycles through all images.
 */
export function WikiBirdThumbnail({
  speciesName,
  imageUrl: imageUrlProp,
  galleryUrls,
  allowLookup = true,
  alt,
  className,
  loading: externalLoading,
}: WikiBirdThumbnailProps) {
  const hookUrl = useBirdImage(imageUrlProp || !allowLookup ? undefined : speciesName)
  const primaryUrl = imageUrlProp || hookUrl

  // Build combined image list: primary + gallery
  const allUrls = primaryUrl
    ? [primaryUrl, ...(galleryUrls ?? [])]
    : galleryUrls ?? []

  const [index, setIndex] = useState(0)
  const [portrait, setPortrait] = useState(false)
  const touchStartX = useRef<number | null>(null)

  // Reset index when species changes (allUrls reference changes)
  const prevSpecies = useRef(speciesName)
  if (prevSpecies.current !== speciesName) {
    prevSpecies.current = speciesName
    setIndex(0)
    setPortrait(false)
  }

  const total = allUrls.length
  const currentUrl = total > 0 ? allUrls[Math.min(index, total - 1)] : undefined
  const hasMultiple = total > 1

  const advance = useCallback(() => {
    if (hasMultiple) setIndex((i) => (i + 1) % total)
  }, [hasMultiple, total])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }, [])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null || !hasMultiple) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    touchStartX.current = null
    if (Math.abs(dx) < 30) return // too short, let click handle it
    if (dx < 0) setIndex((i) => (i + 1) % total) // swipe left = next
    else setIndex((i) => (i - 1 + total) % total) // swipe right = prev
  }, [hasMultiple, total])

  return (
    <div
      className={cn(
        'aspect-square rounded-lg overflow-hidden bg-muted/20 relative',
        hasMultiple && 'cursor-pointer',
        className,
      )}
      onClick={advance}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {currentUrl ? (
        <img
          key={currentUrl}
          src={currentUrl}
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
      {hasMultiple && (
        <div className="absolute bottom-1.5 left-0 right-0 flex justify-center gap-1">
          {allUrls.map((_, i) => (
            <div
              key={i}
              className={cn(
                'w-1.5 h-1.5 rounded-full transition-colors',
                i === Math.min(index, total - 1)
                  ? 'bg-white'
                  : 'bg-white/40',
              )}
            />
          ))}
        </div>
      )}
    </div>
  )
}
