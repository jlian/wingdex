import { useState, useEffect } from 'react'
import { getWikimediaImage } from '@/lib/wikimedia'

/**
 * Hook to fetch a Wikipedia/Wikimedia Commons bird image for a species name.
 * Returns the image URL or undefined while loading.
 */
export function useBirdImage(speciesName: string | undefined): string | undefined {
  const [imageUrl, setImageUrl] = useState<string | undefined>()

  useEffect(() => {
    if (!speciesName) return
    let cancelled = false

    getWikimediaImage(speciesName).then(url => {
      if (!cancelled) setImageUrl(url)
    })

    return () => { cancelled = true }
  }, [speciesName])

  return imageUrl
}
