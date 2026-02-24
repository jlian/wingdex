import { useState, useEffect } from 'react'
import { getWikimediaImage, getWikimediaSummary } from '@/lib/wikimedia'
import type { WikiSummary } from '@/lib/wikimedia'

/**
 * Hook to fetch a Wikipedia/Wikimedia Commons bird image for a species name.
 * Returns the image URL or undefined while loading.
 */
export function useBirdImage(speciesName: string | undefined): string | undefined {
  const { imageUrl } = useBirdImageWithStatus(speciesName)
  return imageUrl
}

/**
 * Hook to fetch a Wikipedia/Wikimedia Commons bird image for a species name.
 * Returns URL plus loading state for layout-stable placeholders.
 */
export function useBirdImageWithStatus(speciesName: string | undefined): {
  imageUrl: string | undefined
  loading: boolean
} {
  const [imageUrl, setImageUrl] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!speciesName) {
      setImageUrl(undefined)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)

    getWikimediaImage(speciesName).then((url) => {
      if (!cancelled) {
        setImageUrl(url)
        setLoading(false)
      }
    })

    return () => { cancelled = true }
  }, [speciesName])

  return { imageUrl, loading }
}

/**
 * Hook to fetch Wikipedia summary (extract text + image + link) for a species.
 */
export function useBirdSummary(speciesName: string | undefined): {
  summary: WikiSummary | undefined
  loading: boolean
} {
  const [summary, setSummary] = useState<WikiSummary | undefined>()
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!speciesName) return
    let cancelled = false
    setLoading(true)

    getWikimediaSummary(speciesName).then(s => {
      if (!cancelled) {
        setSummary(s)
        setLoading(false)
      }
    })

    return () => { cancelled = true }
  }, [speciesName])

  return { summary, loading }
}
