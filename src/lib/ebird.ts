import type { Outing, Observation, ImportPreview, DexEntry } from './types'
import { getDisplayName, getScientificName } from './utils'
import { getTimezoneFromCoords, getOffsetForLocalWallTime, dateToLocalISOWithOffset } from './timezone'

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

const EBIRD_RECORD_HEADERS = [
  'Common Name',
  'Genus',
  'Species',
  'Number',
  'Species Comments',
  'Location Name',
  'Latitude',
  'Longitude',
  'Date',
  'Start Time',
  'State/Province',
  'Country Code',
  'Protocol',
  'Number of Observers',
  'Duration',
  'All observations reported?',
  'Effort Distance Miles',
  'Effort area acres',
  'Submission Comments',
] as const

interface RecordExportOptions {
  includeHeader?: boolean
}

function sanitizeForEBird(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/"/g, '')
    .trim()
}

function splitScientificName(scientificName: string): { genus: string; species: string } {
  const cleaned = sanitizeForEBird(scientificName)
  if (!cleaned) return { genus: '', species: '' }
  const parts = cleaned.split(/\s+/)
  if (parts.length < 2) return { genus: parts[0] || '', species: '' }
  return {
    genus: parts[0],
    species: parts.slice(1).join(' '),
  }
}

/**
 * Groups parsed import previews into outing-shaped data.
 * When submissionId is available (eBird download), records sharing the same
 * submissionId become one outing. Otherwise falls back to date + location grouping.
 */
export function groupPreviewsIntoOutings(
  previews: ImportPreview[],
  userId: string
): { outings: Outing[]; observations: Observation[] } {
  const groups = new Map<string, ImportPreview[]>()
  const submissionIdCounts = new Map<string, number>()

  for (const p of previews) {
    if (!p.submissionId) continue
    submissionIdCounts.set(p.submissionId, (submissionIdCounts.get(p.submissionId) || 0) + 1)
  }

  for (const p of previews) {
    // Extract local date from offset-aware ISO (e.g. "2024-12-18T19:16:00-10:00" → "2024-12-18")
    // so grouping uses observation-local calendar day, not UTC day.
    const dateKey = p.date.slice(0, 10)
    const key =
      p.submissionId && (submissionIdCounts.get(p.submissionId) || 0) > 1
        ? p.submissionId
        : `${dateKey}||${p.location}`
    const existing = groups.get(key)
    if (existing) {
      existing.push(p)
    } else {
      groups.set(key, [p])
    }
  }

  const outings: Outing[] = []
  const observations: Observation[] = []

  for (const [, group] of groups) {
    const outingId = `outing_import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const first = group[0]
    const startTime = first.date
    // Use latest record time or +1h as endTime, keeping it offset-aware
    const dates = group.map(p => new Date(p.date).getTime())
    const latestDate = new Date(Math.max(...dates) + 3600000)
    const endTime = (first.lat != null && first.lon != null)
      ? dateToLocalISOWithOffset(latestDate, first.lat, first.lon)
      : latestDate.toISOString()

    const checklistNotes = first.checklistNotes || ''
    const outingNotes = checklistNotes
      ? `Imported from eBird – ${checklistNotes}`
      : 'Imported from eBird'

    outings.push({
      id: outingId,
      userId,
      startTime,
      endTime,
      locationName: first.location,
      defaultLocationName: first.location,
      lat: first.lat,
      lon: first.lon,
      notes: outingNotes,
      createdAt: new Date().toISOString(),
    })

    // Deduplicate species within the group
    const speciesMap = new Map<string, { count: number; notes: string }>()
    for (const p of group) {
      const existing = speciesMap.get(p.speciesName)
      if (existing) {
        existing.count += p.count
        if (p.observationNotes && !existing.notes.includes(p.observationNotes)) {
          existing.notes = existing.notes
            ? `${existing.notes}; ${p.observationNotes}`
            : p.observationNotes
        }
      } else {
        speciesMap.set(p.speciesName, { count: p.count, notes: p.observationNotes || '' })
      }
    }

    for (const [species, info] of speciesMap) {
      observations.push({
        id: `obs_import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        outingId,
        speciesName: species,
        count: info.count,
        certainty: 'confirmed',
        notes: info.notes,
      })
    }
  }

  return { outings, observations }
}

export function exportOutingToEBirdCSV(
  outing: Outing,
  observations: Observation[],
  options: RecordExportOptions = {}
): string {
  const { includeHeader = false } = options

  // Parse the local date/time from the stored ISO string (which may have
  // a timezone offset like "2024-12-18T19:16:00-10:00").  Using
  // new Date().getHours() would convert to the browser's timezone, giving
  // wrong results when browser TZ differs from the observation TZ.
  const localMatch = outing.startTime.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/
  )
  const date = localMatch
    ? `${localMatch[2]}/${localMatch[3]}/${localMatch[1]}`
    : (() => {
        const d = new Date(outing.startTime)
        return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`
      })()
  const time = localMatch
    ? `${localMatch[4]}:${localMatch[5]}`
    : (() => {
        const d = new Date(outing.startTime)
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      })()

  const rows = observations
    .filter(obs => obs.certainty === 'confirmed')
    .map(obs => {
      const commonName = sanitizeForEBird(getDisplayName(obs.speciesName))
      const scientificName = getScientificName(obs.speciesName) || ''
      const { genus, species } = splitScientificName(scientificName)
      const speciesComments = sanitizeForEBird(obs.notes || '')
      const submissionComments = sanitizeForEBird(outing.notes || '')

      return [
        commonName,
        genus,
        species,
        obs.count > 0 ? String(obs.count) : 'X', // eBird convention: X = present
        speciesComments,
        sanitizeForEBird(outing.locationName),
        outing.lat?.toFixed(6) || '',
        outing.lon?.toFixed(6) || '',
        date,
        time,
        '',
        '',
        'Incidental',
        '1',
        '',
        'N',
        '',
        '',
        submissionComments,
      ]
    })

  const csv = [
    ...(includeHeader ? [EBIRD_RECORD_HEADERS.join(',')] : []),
    ...rows.map(row => row.map(cell => csvEscape(cell)).join(','))
  ].join('\n')

  return csv
}

export function parseEBirdCSV(csvContent: string): ImportPreview[] {
  const lines = csvContent.split('\n').filter(line => line.trim())
  if (lines.length === 0) return []

  const headers = parseCSVLine(lines[0]).map(header => header.trim().toLowerCase())
  const previews: ImportPreview[] = []
  
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i])
    const row: Record<string, string> = {}
    
    headers.forEach((header, index) => {
      row[header] = values[index] || ''
    })
    
    const speciesName = row['common name'] || row['species'] || row['species name']
    const scientificName = row['scientific name'] || row['species']
    const date = row['date'] || row['observation date'] || row['obs date']
    const location = row['location'] || row['location name'] || row['locality']
    const rawCount = (row['count'] || row['number'] || '').trim()
    const lat = parseFloat(row['latitude'] || row['lat'] || '')
    const lon = parseFloat(row['longitude'] || row['lon'] || row['lng'] || '')
    const time = row['time'] || row['start time'] || ''
    const submissionId = row['submission id'] || ''
    const stateProvince = row['state/province'] || row['state'] || ''
    const observationNotes = row['observation details'] || row['species comments'] || ''
    const checklistNotes = row['checklist comments'] || row['submission comments'] || ''
    
    if (speciesName && date) {
      const normalizedDate = normalizeDate(date, time, isNaN(lat) ? undefined : lat, isNaN(lon) ? undefined : lon)
      if (!normalizedDate) continue

      // "X" means species present but not counted — treat as 1
      const count = rawCount.toUpperCase() === 'X' ? 1 : parseInt(rawCount || '1', 10)

      const fullName = scientificName && !speciesName.includes('(')
        ? `${speciesName} (${scientificName})`
        : speciesName

      previews.push({
        speciesName: fullName,
        date: normalizedDate,
        location: location || 'Unknown',
        count: isNaN(count) ? 1 : count,
        lat: isNaN(lat) ? undefined : lat,
        lon: isNaN(lon) ? undefined : lon,
        time: time || undefined,
        submissionId: submissionId || undefined,
        stateProvince: stateProvince || undefined,
        observationNotes: observationNotes || undefined,
        checklistNotes: checklistNotes || undefined,
      })
    }
  }
  
  return previews
}

function parseCSVLine(line: string): string[] {
  const values: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (char === '"') {
      const nextChar = line[i + 1]
      if (inQuotes && nextChar === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim().replace(/^"|"$/g, ''))
      current = ''
    } else {
      current += char
    }
  }

  values.push(current.trim().replace(/^"|"$/g, ''))
  return values
}

function normalizeDate(dateStr: string, timeStr?: string, lat?: number, lon?: number): string | null {
  try {
    // Parse date components to construct a local-time Date.
    // new Date("2024-01-15") treats the string as UTC, but eBird dates are
    // local, so we must parse them as local to avoid timezone shifts (#52).
    const parts = dateStr.trim().match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
    let year: number, month: number, day: number
    if (parts) {
      year = parseInt(parts[1], 10)
      month = parseInt(parts[2], 10) - 1
      day = parseInt(parts[3], 10)
    } else {
      // Fallback for other formats (e.g. "Jan 15, 2024")
      const fallback = new Date(dateStr)
      if (isNaN(fallback.getTime())) return null
      year = fallback.getFullYear()
      month = fallback.getMonth()
      day = fallback.getDate()
    }

    let hours = 0, minutes = 0
    if (timeStr) {
      const parsed = parseTimeString(timeStr)
      if (parsed) {
        hours = parsed.hours
        minutes = parsed.minutes
      }
    }

    // Build a local datetime string and attach timezone offset (#59)
    const pad = (n: number) => String(n).padStart(2, '0')
    const localStr = `${year}-${pad(month + 1)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00`

    const timezone = (lat != null && lon != null)
      ? getTimezoneFromCoords(lat, lon)
      : Intl.DateTimeFormat().resolvedOptions().timeZone
    const offset = getOffsetForLocalWallTime(timezone, year, month, day, hours, minutes)
    return `${localStr}${offset}`
  } catch {
    
  }
  return null
}

/**
 * Parse time strings in 12-hour ("08:15 AM") or 24-hour ("14:30") format.
 */
function parseTimeString(timeStr: string): { hours: number; minutes: number } | null {
  const trimmed = timeStr.trim()
  if (!trimmed) return null

  // 12-hour format: "08:15 AM", "1:09 PM"
  const match12 = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (match12) {
    let hours = parseInt(match12[1], 10)
    const minutes = parseInt(match12[2], 10)
    const period = match12[3].toUpperCase()
    if (period === 'AM' && hours === 12) hours = 0
    if (period === 'PM' && hours !== 12) hours += 12
    return { hours, minutes }
  }

  // 24-hour format: "14:30", "08:15"
  const match24 = trimmed.match(/^(\d{1,2}):(\d{2})$/)
  if (match24) {
    return { hours: parseInt(match24[1], 10), minutes: parseInt(match24[2], 10) }
  }

  return null
}

export function detectImportConflicts(
  previews: ImportPreview[],
  existingDex: Map<string, DexEntry>
): ImportPreview[] {
  // Build a secondary index for exact case-insensitive fallback matching by display (common) name
  const byDisplayName = new Map<string, DexEntry>()
  for (const entry of existingDex.values()) {
    byDisplayName.set(getDisplayName(entry.speciesName).toLowerCase(), entry)
  }

  return previews.map(preview => {
    const existing = existingDex.get(preview.speciesName)
      ?? byDisplayName.get(getDisplayName(preview.speciesName).toLowerCase())
    
    if (!existing) {
      return { ...preview, conflict: 'new' }
    }
    
    const previewDate = new Date(preview.date)
    const firstSeen = new Date(existing.firstSeenDate)
    const lastSeen = new Date(existing.lastSeenDate)
    
    if (previewDate >= firstSeen && previewDate <= lastSeen) {
      return { ...preview, conflict: 'duplicate', existingEntry: existing }
    }
    
    if (previewDate < firstSeen || previewDate > lastSeen) {
      return { ...preview, conflict: 'update_dates', existingEntry: existing }
    }
    
    return { ...preview, conflict: 'new', existingEntry: existing }
  })
}

export function exportDexToCSV(dex: DexEntry[]): string {
  const headers = [
    'Common Name',
    'Scientific Name',
    'First Seen Date',
    'Last Seen Date',
    'Total Outings',
    'Total Count',
    'Notes'
  ]
  
  const rows = dex.map(entry => {
    const commonName = getDisplayName(entry.speciesName)
    const scientificName = getScientificName(entry.speciesName) || ''
    return [
      commonName,
      scientificName,
      formatISODate(entry.firstSeenDate),
      formatISODate(entry.lastSeenDate),
      entry.totalOutings.toString(),
      entry.totalCount.toString(),
      entry.notes || ''
    ]
  })
  
  const csv = [
    headers.map(h => csvEscape(h)).join(','),
    ...rows.map(row => row.map(cell => csvEscape(cell)).join(','))
  ].join('\n')
  
  return csv
}

/** Format an ISO date string as YYYY-MM-DD for stable CSV output */
function formatISODate(isoString: string): string {
  try {
    const d = new Date(isoString)
    if (isNaN(d.getTime())) return isoString
    return d.toISOString().split('T')[0]
  } catch {
    return isoString
  }
}
