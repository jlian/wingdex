import { useState, useEffect } from 'react'
import { getWikimediaImage, getWikimediaSummary } from '@/lib/wikimedia'
import type { WikiSummary } from '@/lib/wikimedia'

/**
 * Hook to fetch a Wikipedia/Wikimedia Commons bird image for a species name.
 * Returns the image URL or undefined while loading.
 */
export function useBirdImage(speciesName: string | undefined): string | undefined {
  const [imageUrl, setImageUrl] = useState<string | undefined>()

  useEffect(() => {
    if (!speciesName) return
    let cancelled = false
    let objectUrl: string | undefined

    const isIOS = typeof navigator !== 'undefined'
      && /iPad|iPhone|iPod/.test(navigator.userAgent)

    getWikimediaImage(speciesName).then(async (url) => {
      if (cancelled) return
      if (!url) {
        setImageUrl(undefined)
        return
      }

      const shouldUseBlob = isIOS && url.includes('/thumb/')
      if (!shouldUseBlob) {
        setImageUrl(url)
        return
      }

      try {
        const response = await fetch(url)
        if (!response.ok) {
          // Blob fetch failed; fall back to direct URL
          if (!cancelled) setImageUrl(url)
          return
        }
        const blob = await response.blob()
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setImageUrl(objectUrl)
      } catch {
        // Blob fetch failed; fall back to direct URL
        if (!cancelled) setImageUrl(url)
      }
    })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [speciesName])

  return imageUrl
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
