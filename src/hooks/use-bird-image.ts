import { useState, useEffect } from 'react'
import { getWikimediaImage, getWikimediaSummary, getWikimediaGallery } from '@/lib/wikimedia'
import type { WikiSummary, GalleryImage } from '@/lib/wikimedia'

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
export function useBirdSummary(
  speciesName: string | undefined,
  options?: { wikiTitle?: string }
): {
  summary: WikiSummary | undefined
  loading: boolean
} {
  const [summary, setSummary] = useState<WikiSummary | undefined>()
  const [loading, setLoading] = useState(false)
  const wikiTitle = options?.wikiTitle

  useEffect(() => {
    if (!speciesName) return
    let cancelled = false
    setLoading(true)

    getWikimediaSummary(speciesName, { wikiTitle }).then(s => {
      if (!cancelled) {
        setSummary(s)
        setLoading(false)
      }
    })

    return () => { cancelled = true }
  }, [speciesName, wikiTitle])

  return { summary, loading }
}

/**
 * Hook to fetch reference images for a species from Wikimedia Commons.
 * Returns GalleryImage objects with url, caption, title, and parsed plumage tags.
 */
export function useBirdGallery(speciesName: string | undefined): {
  images: GalleryImage[]
  loading: boolean
} {
  const [images, setImages] = useState<GalleryImage[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!speciesName) {
      setImages([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)

    getWikimediaGallery(speciesName).then((urls) => {
      if (!cancelled) {
        setImages(urls)
        setLoading(false)
      }
    })

    return () => { cancelled = true }
  }, [speciesName])

  return { images, loading }
}
