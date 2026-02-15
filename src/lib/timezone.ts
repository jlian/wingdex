import tzlookup from 'tz-lookup'

/**
 * Get IANA timezone string from GPS coordinates.
 * Returns e.g. "America/Los_Angeles", "Pacific/Honolulu".
 */
export function getTimezoneFromCoords(lat: number, lon: number): string {
  return tzlookup(lat, lon)
}

/**
 * Get the UTC offset string (e.g. "+00:00", "-10:00", "+05:30") for a given
 * IANA timezone at a specific date/time.
 *
 * We use Intl.DateTimeFormat to resolve the offset, which correctly handles
 * DST transitions for the given date.
 */
export function getUtcOffsetString(timezone: string, date: Date): string {
  // Format the date in the target timezone to get the UTC offset
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
  }).formatToParts(date)

  const tzPart = parts.find(p => p.type === 'timeZoneName')
  if (!tzPart) return '+00:00'

  // tzPart.value is like "GMT", "GMT-10:00", "GMT+5:30"
  const match = tzPart.value.match(/GMT([+-]\d{1,2}(?::\d{2})?)/)
  if (!match) return '+00:00' // "GMT" with no offset means UTC

  let offset = match[1]
  // Normalize: ensure hours are two digits, e.g. "+5:30" → "+05:30"
  offset = offset.replace(/^([+-])(\d)(?=:)/, '$10$2')
  // Ensure minutes are present, e.g. "+05" → "+05:00"
  if (!offset.includes(':')) offset += ':00'
  return offset
}

/**
 * Format a naive local datetime string (e.g. "2024-01-15 17:00:00" from EXIF)
 * as an ISO 8601 string with timezone offset, using GPS coords to determine timezone.
 *
 * Example: "2024-01-15 17:00:00" + Maui coords → "2024-01-15T17:00:00-10:00"
 */
export function toLocalISOWithOffset(
  localDatetime: string,
  lat?: number,
  lon?: number,
): string {
  // Normalize separators: "2024:01:15 17:00:00" → "2024-01-15T17:00:00"
  const normalized = localDatetime.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').replace(' ', 'T')

  if (lat != null && lon != null) {
    const timezone = getTimezoneFromCoords(lat, lon)
    // Parse the local datetime to get a Date (interpreted as local browser time, but we only
    // need it for DST offset lookup — the actual date/time values come from the string)
    const tempDate = new Date(normalized)
    const offset = getUtcOffsetString(timezone, tempDate)
    return `${normalized}${offset}`
  }

  // Fallback: use browser's local timezone
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const tempDate = new Date(normalized)
  const offset = getUtcOffsetString(browserTz, tempDate)
  return `${normalized}${offset}`
}

/**
 * Format a Date object as an ISO 8601 string with timezone offset.
 * Used by the eBird CSV import path where we already have a Date and GPS coords.
 *
 * Example: Date(2024-01-15T03:00:00Z) + Maui coords → "2024-01-15T17:00:00-10:00"
 */
export function dateToLocalISOWithOffset(
  date: Date,
  lat?: number,
  lon?: number,
): string {
  const timezone = (lat != null && lon != null)
    ? getTimezoneFromCoords(lat, lon)
    : Intl.DateTimeFormat().resolvedOptions().timeZone

  const offset = getUtcOffsetString(timezone, date)

  // Format the date in the target timezone
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  // sv-SE locale gives us "YYYY-MM-DD HH:MM:SS" format
  const formatted = fmt.format(date).replace(' ', 'T')
  return `${formatted}${offset}`
}

/**
 * Parse a stored time string and display it in its original timezone.
 * Handles both:
 *  - ISO with offset: "2024-01-15T17:00:00-10:00" → shows 5:00 PM
 *  - Legacy UTC ISO: "2024-01-15T03:00:00.000Z" → shows in browser local time (legacy behavior)
 *  - Naive local: "2024-01-15 17:00:00" → shows as-is in browser local time (legacy behavior)
 */
export function parseStoredTime(timeStr: string): { date: Date; timezone?: string } {
  // Check for offset like +05:30 or -10:00 at end (but not Z)
  const offsetMatch = timeStr.match(/([+-]\d{2}:\d{2})$/)
  if (offsetMatch) {
    return {
      date: new Date(timeStr),
      // We can't directly recover the IANA timezone from just an offset,
      // but we can use the offset for display purposes
      timezone: undefined, // Display will use the offset from the ISO string
    }
  }
  return { date: new Date(timeStr) }
}

/**
 * Format a stored time string for display, respecting the original timezone offset.
 * For offset-aware strings, displays in the original local time.
 * For legacy strings, displays in browser local time.
 */
export function formatStoredDate(
  timeStr: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const offsetMatch = timeStr.match(/([+-])(\d{2}):(\d{2})$/)
  if (offsetMatch) {
    // Extract the local date/time components from the string directly
    // "2024-01-15T17:00:00-10:00" → we want to show "Jan 15, 2024"
    const localPart = timeStr.slice(0, -6) // Remove the offset
    // Parse the local part as a date (treating it as UTC to avoid browser timezone shifts)
    const [datePart, timePart] = localPart.split('T')
    const [year, month, day] = datePart.split('-').map(Number)
    const [hour, minute, second] = (timePart || '00:00:00').split(':').map(Number)

    // Create a Date in UTC with these values, then format in UTC
    // This preserves the original local time for display
    const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second))

    const defaultOpts: Intl.DateTimeFormatOptions = {
      timeZone: 'UTC',
      ...options,
    }
    return utcDate.toLocaleDateString(undefined, defaultOpts)
  }

  // Legacy: use browser local time
  return new Date(timeStr).toLocaleDateString(undefined, options)
}

/**
 * Format a stored time string for time display (e.g. "5:00 PM").
 */
export function formatStoredTime(
  timeStr: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const offsetMatch = timeStr.match(/([+-])(\d{2}):(\d{2})$/)
  if (offsetMatch) {
    const localPart = timeStr.slice(0, -6)
    const [datePart, timePart] = localPart.split('T')
    const [year, month, day] = datePart.split('-').map(Number)
    const [hour, minute, second] = (timePart || '00:00:00').split(':').map(Number)

    const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second))

    const defaultOpts: Intl.DateTimeFormatOptions = {
      timeZone: 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      ...options,
    }
    return utcDate.toLocaleTimeString([], defaultOpts)
  }

  // Legacy: use browser local time
  return new Date(timeStr).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    ...options,
  })
}
