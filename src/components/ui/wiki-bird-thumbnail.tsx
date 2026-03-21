import { useState, useCallback, useRef, useEffect } from 'react'
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
 * When galleryUrls are provided, swipe or use arrow buttons to navigate.
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
  const [direction, setDirection] = useState<'left' | 'right'>('left')
  const [animKey, setAnimKey] = useState(0)
  const touchStartX = useRef<number | null>(null)
  const didSwipe = useRef(false)

  // Reset index when species changes
  useEffect(() => {
    setIndex(0)
    setPortrait(false)
  }, [speciesName])

  const total = allUrls.length
  const currentUrl = total > 0 ? allUrls[Math.min(index, total - 1)] : undefined
  const hasMultiple = total > 1

  const goNext = useCallback(() => {
    if (!hasMultiple) return
    setDirection('left')
    setIndex((i) => (i + 1) % total)
    setAnimKey((k) => k + 1)
  }, [hasMultiple, total])

  const goPrev = useCallback(() => {
    if (!hasMultiple) return
    setDirection('right')
    setIndex((i) => (i - 1 + total) % total)
    setAnimKey((k) => k + 1)
  }, [hasMultiple, total])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    didSwipe.current = false
  }, [])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null || !hasMultiple) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    touchStartX.current = null
    if (Math.abs(dx) < 30) return
    didSwipe.current = true
    if (dx < 0) goNext()
    else goPrev()
  }, [hasMultiple, goNext, goPrev])

  const handleClick = useCallback(() => {
    if (didSwipe.current) { didSwipe.current = false; return }
    goNext()
  }, [goNext])

  return (
    <div
      className={cn(
        'aspect-square rounded-lg overflow-hidden bg-muted/20 relative group',
        className,
      )}
      onClick={hasMultiple ? handleClick : undefined}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {currentUrl ? (
        <img
          key={`${currentUrl}-${animKey}`}
          src={currentUrl}
          alt={alt ?? speciesName}
          loading={SHOULD_LAZY_LOAD_THUMBNAILS ? 'lazy' : 'eager'}
          onLoad={(e) => {
            const img = e.currentTarget
            setPortrait(img.naturalHeight > img.naturalWidth)
          }}
          className={cn(
            'w-full h-full object-cover',
            hasMultiple && 'animate-gallery-slide',
          )}
          style={{
            objectPosition: portrait ? 'center top' : 'center center',
            '--slide-from': direction === 'left' ? '8%' : '-8%',
          } as React.CSSProperties}
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

      {/* Arrow buttons (hover only, touch devices use swipe) */}
      {hasMultiple && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); goPrev() }}
            className="absolute left-0 top-0 bottom-0 w-8 flex items-center justify-center
              opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-200
              bg-gradient-to-r from-black/20 to-transparent text-white/80 hover:text-white"
            aria-label="Previous image"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="drop-shadow">
              <path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); goNext() }}
            className="absolute right-0 top-0 bottom-0 w-8 flex items-center justify-center
              opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-200
              bg-gradient-to-l from-black/20 to-transparent text-white/80 hover:text-white"
            aria-label="Next image"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="drop-shadow">
              <path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </>
      )}

      {/* Dot indicators */}
      {hasMultiple && (
        <div className="absolute bottom-1.5 left-0 right-0 flex justify-center gap-1">
          {allUrls.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setDirection(i > index ? 'left' : 'right')
                setIndex(i)
                setAnimKey((k) => k + 1)
              }}
              className={cn(
                'w-1.5 h-1.5 rounded-full transition-all duration-200',
                i === Math.min(index, total - 1)
                  ? 'bg-white scale-110'
                  : 'bg-white/40 hover:bg-white/60',
              )}
              aria-label={`Image ${i + 1} of ${total}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
