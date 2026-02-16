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
  // longOffset may throw on older iOS/Safari — fall back to shortOffset then short
  let parts: Intl.DateTimeFormatPart[] | undefined
  for (const tzName of ['longOffset', 'shortOffset', 'short'] as const) {
    try {
      parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        timeZoneName: tzName,
      }).formatToParts(date)
      break
    } catch {
      // try next format
    }
  }
  if (!parts) return '+00:00'

  const tzPart = parts.find(p => p.type === 'timeZoneName')
  if (!tzPart) return '+00:00'

  // tzPart.value is like "GMT", "GMT-10:00", "GMT+5:30", "GMT+5"
  const match = tzPart.value.match(/GMT([+-]\d{1,2}(?::\d{2})?)/)
  if (!match) return '+00:00' // "GMT" with no offset means UTC

  let offset = match[1]
  // Normalize: ensure hours are two digits, e.g. "+5:30" → "+05:30", "+5" → "+05"
  offset = offset.replace(/^([+-])(\d)(?=:|$)/, '$10$2')
  // Ensure minutes are present, e.g. "+05" → "+05:00"
  if (!offset.includes(':')) offset += ':00'
  return offset
}

/**
 * Parse an offset string like "+05:30" or "-10:00" into milliseconds.
 */
function parseOffsetMs(offset: string): number {
  const m = offset.match(/^([+-])(\d{2}):(\d{2})$/)
  if (!m) return 0
  const sign = m[1] === '+' ? 1 : -1
  return sign * (Number(m[2]) * 60 + Number(m[3])) * 60_000
}

/**
 * Get the correct UTC offset for a given local wall time in a timezone.
 * Uses an iterative approach to handle DST transitions correctly:
 * the naive Date.UTC guess may land on the wrong side of a DST boundary,
 * so we correct by computing the actual UTC instant from the first offset
 * and re-checking.
 */
export function getOffsetForLocalWallTime(
  timezone: string,
  year: number, month: number, day: number,
  hour: number = 0, minute: number = 0, second: number = 0,
): string {
  // First guess: treat wall-time components as UTC
  const wallAsUtc = Date.UTC(year, month, day, hour, minute, second)
  const offset1 = getUtcOffsetString(timezone, new Date(wallAsUtc))
  const offsetMs1 = parseOffsetMs(offset1)

  // Corrected UTC: wall time - offset (since wallTime = utc + offset)
  const correctedUtc = wallAsUtc - offsetMs1
  const offset2 = getUtcOffsetString(timezone, new Date(correctedUtc))

  if (offset1 === offset2) return offset1

  // If inconsistent (DST boundary), re-correct with the second offset
  const offsetMs2 = parseOffsetMs(offset2)
  const correctedUtc2 = wallAsUtc - offsetMs2
  const offset3 = getUtcOffsetString(timezone, new Date(correctedUtc2))
  return offset3
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

  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/)
  const tempDate = match
    ? new Date(Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6] ?? '0'),
    ))
    : new Date(normalized)

  const year = match ? Number(match[1]) : tempDate.getUTCFullYear()
  const month = match ? Number(match[2]) - 1 : tempDate.getUTCMonth()
  const day = match ? Number(match[3]) : tempDate.getUTCDate()
  const hour = match ? Number(match[4]) : tempDate.getUTCHours()
  const min = match ? Number(match[5]) : tempDate.getUTCMinutes()
  const sec = match ? Number(match[6] ?? '0') : tempDate.getUTCSeconds()

  const timezone = (lat != null && lon != null)
    ? getTimezoneFromCoords(lat, lon)
    : Intl.DateTimeFormat().resolvedOptions().timeZone
  const offset = getOffsetForLocalWallTime(timezone, year, month, day, hour, min, sec)
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
 * Convert a naive datetime from one timezone to an offset-aware ISO string in
 * the observation-local timezone (determined by GPS coords).
 *
 * Used by eBird CSV import where the exported time is in the user's profile
 * timezone, not the observation's local timezone.
 *
 * Example: "2024-12-18T19:16:00" in "America/Los_Angeles" + Maui GPS
 *   → UTC: 2024-12-19T03:16:00Z
 *   → Maui local: "2024-12-18T17:16:00-10:00"
 */
export function convertTimezones(
  naiveDatetime: string,
  sourceTimezone: string,
  lat?: number,
  lon?: number,
): string {
  const match = naiveDatetime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) return naiveDatetime

  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const hour = Number(match[4])
  const min = Number(match[5])
  const sec = Number(match[6] ?? '0')

  // Get the offset of the source timezone at this wall time
  const sourceOffset = getOffsetForLocalWallTime(sourceTimezone, year, month, day, hour, min, sec)
  const sourceOffsetMs = parseOffsetMs(sourceOffset)

  // Compute the UTC instant: wall time - source offset
  const wallAsUtc = Date.UTC(year, month, day, hour, min, sec)
  const utcMs = wallAsUtc - sourceOffsetMs

  // Now convert that UTC instant to the observation-local timezone
  return dateToLocalISOWithOffset(new Date(utcMs), lat, lon)
}

/**
 * Get a short timezone abbreviation for an offset-aware ISO string.
 * e.g. "2024-12-18T17:16:00-10:00" → "HST"
 *      "2025-06-01T11:07:00-07:00" → "PDT"
 *      "2025-12-27T15:06:00+08:00" → "CST" (China Standard Time)
 *
 * Falls back to the numeric offset (e.g. "UTC-10") if no abbreviation is available.
 */
export function getTimezoneAbbreviation(timeStr: string): string {
  const offsetMatch = timeStr.match(/([+-])(\d{2}):(\d{2})$/)
  if (!offsetMatch) return ''

  // Parse the date to get the UTC instant, then use Intl to get the abbreviation
  const date = new Date(timeStr)
  if (isNaN(date.getTime())) return ''

  // Find the best IANA timezone for this offset at this instant
  // We use the offset to narrow down, then check with Intl
  const sign = offsetMatch[1] === '+' ? 1 : -1
  const hrs = Number(offsetMatch[2])
  const mins = Number(offsetMatch[3])
  const totalMinutes = sign * (hrs * 60 + mins)

  // Try to get abbreviation via Intl with 'short' timeZoneName
  // We need a timezone that matches this offset — use a heuristic approach
  // by trying common timezones
  const commonTimezones: Record<number, string[]> = {
    [-600]: ['Pacific/Honolulu'],
    [-480]: ['America/Los_Angeles'],
    [-420]: ['America/Los_Angeles'],   // PDT
    [-360]: ['America/Chicago'],
    [-300]: ['America/Chicago'],       // CDT
    [480]: ['Asia/Taipei', 'Asia/Shanghai'],
    [540]: ['Asia/Tokyo'],
    [330]: ['Asia/Kolkata'],
    [345]: ['Asia/Kathmandu'],
    [0]: ['UTC'],
    [60]: ['Europe/London'],           // BST
    [120]: ['Europe/Paris'],
  }

  const candidates = commonTimezones[totalMinutes]
  if (candidates) {
    for (const tz of candidates) {
      try {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          timeZoneName: 'short',
        }).formatToParts(date)
        const tzPart = parts.find(p => p.type === 'timeZoneName')
        if (tzPart) {
          // Verify this timezone actually has the right offset at this instant
          const actualOffset = getUtcOffsetString(tz, date)
          const actualMs = parseOffsetMs(actualOffset)
          if (actualMs === totalMinutes * 60_000) {
            return tzPart.value
          }
        }
      } catch {
        // skip
      }
    }
  }

  // Fallback: numeric offset
  const sign2 = totalMinutes >= 0 ? '+' : '-'
  const absHrs = Math.floor(Math.abs(totalMinutes) / 60)
  const absMins = Math.abs(totalMinutes) % 60
  return absMins > 0
    ? `UTC${sign2}${absHrs}:${String(absMins).padStart(2, '0')}`
    : `UTC${sign2}${absHrs}`
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

/**
 * Format a stored time string with timezone abbreviation (e.g. "5:16 PM HST").
 */
export function formatStoredTimeWithTZ(timeStr: string): string {
  const time = formatStoredTime(timeStr)
  const tz = getTimezoneAbbreviation(timeStr)
  return tz ? `${time} ${tz}` : time
}
