import { dateToLocalISOWithOffset, getTimezoneFromCoords } from '../../src/lib/timezone'

export function coordinateTimeZone(lat?: number | null, lon?: number | null): string | undefined {
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)
    || Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined
  try {
    return getTimezoneFromCoords(lat, lon)
  } catch {
    return undefined
  }
}

export function localizeUTCTimestamp(time: string, lat?: number | null, lon?: number | null): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(time)
    || !coordinateTimeZone(lat, lon)) return time
  const instant = new Date(time)
  if (!Number.isFinite(instant.getTime())) return time
  if (instant.toISOString().slice(0, 19) !== time.slice(0, 19)) return time
  const localized = dateToLocalISOWithOffset(instant, lat!, lon!)
  const fractionalSeconds = time.match(/\.\d+(?=Z$)/)?.[0] ?? ''
  return fractionalSeconds ? localized.replace(/([+-]\d{2}:\d{2})$/, `${fractionalSeconds}$1`) : localized
}

export function localizeOutingTimes<Outing extends {
  startTime: string
  endTime?: string
  lat?: number | null
  lon?: number | null
}>(outing: Outing): Outing {
  return {
    ...outing,
    startTime: localizeUTCTimestamp(outing.startTime, outing.lat, outing.lon),
    ...(outing.endTime == null ? {} : { endTime: localizeUTCTimestamp(outing.endTime, outing.lat, outing.lon) }),
  }
}
