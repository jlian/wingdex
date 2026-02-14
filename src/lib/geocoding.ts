/**
 * Forward geocoding: look up coordinates from a location name
 * using OpenStreetMap Nominatim.
 */
export interface GeocodingResult {
  lat: number
  lon: number
  displayName: string
}

export async function forwardGeocode(query: string): Promise<GeocodingResult | null> {
  if (!query.trim()) return null

  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query.trim())}&format=json&limit=1&addressdetails=1`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'BirdDex-App/1.0' },
  })

  if (!res.ok) throw new Error(`Nominatim ${res.status}`)

  const data = await res.json()
  if (!Array.isArray(data) || data.length === 0) return null

  const top = data[0]
  return {
    lat: parseFloat(top.lat),
    lon: parseFloat(top.lon),
    displayName: top.display_name ?? query,
  }
}
