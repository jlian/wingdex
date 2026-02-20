type OutingForExport = {
  id: string
  startTime: string
  locationName: string
  lat?: number | null
  lon?: number | null
  notes?: string | null
}

export type DexEntryForConflict = {
  speciesName: string
  firstSeenDate: string
  lastSeenDate: string
  totalOutings: number
  totalCount: number
  notes?: string | null
}

export type ImportPreview = {
  speciesName: string
  date: string
  location: string
  count: number
  lat?: number
  lon?: number
  time?: string
  submissionId?: string
  stateProvince?: string
  observationNotes?: string
  checklistNotes?: string
  conflict?: 'duplicate' | 'update_dates' | 'new'
  existingEntry?: DexEntryForConflict
}

export type OutingForImport = {
  id: string
  userId: string
  startTime: string
  endTime: string
  locationName: string
  defaultLocationName?: string
  lat?: number
  lon?: number
  notes: string
  createdAt: string
}

export type ObservationForImport = {
  id: string
  outingId: string
  speciesName: string
  count: number
  certainty: 'confirmed' | 'possible' | 'pending' | 'rejected'
  notes: string
}

import {
  convertTimezones,
  dateToLocalISOWithOffset,
  getOffsetForLocalWallTime,
  getTimezoneFromCoords,
} from '../../src/lib/timezone'

type ObservationForExport = {
  speciesName: string
  count: number
  certainty: 'confirmed' | 'possible' | 'pending' | 'rejected'
  notes?: string | null
}

type DexEntryForExport = {
  speciesName: string
  firstSeenDate: string
  lastSeenDate: string
  totalOutings: number
  totalCount: number
  notes?: string | null
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

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function sanitizeForEBird(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/"/g, '').trim()
}

function getDisplayName(speciesName: string): string {
  return speciesName.split('(')[0].trim()
}

function getScientificName(speciesName: string): string | undefined {
  return speciesName.match(/\(([^)]+)\)/)?.[1]
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

function formatISODate(isoString: string): string {
  const localDateMatch = isoString.match(/^(\d{4}-\d{2}-\d{2})/)
  if (localDateMatch) return localDateMatch[1]

  try {
    const date = new Date(isoString)
    if (Number.isNaN(date.getTime())) return isoString
    return date.toISOString().split('T')[0]
  } catch {
    return isoString
  }
}

function parseCSVLine(line: string): string[] {
  const values: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index++) {
    const char = line[index]

    if (char === '"') {
      const nextChar = line[index + 1]
      if (inQuotes && nextChar === '"') {
        current += '"'
        index++
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

function parseTimeString(timeStr: string): { hours: number; minutes: number } | null {
  const trimmed = timeStr.trim()
  if (!trimmed) return null

  const match12 = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (match12) {
    let hours = Number.parseInt(match12[1], 10)
    const minutes = Number.parseInt(match12[2], 10)
    const period = match12[3].toUpperCase()
    if (period === 'AM' && hours === 12) hours = 0
    if (period === 'PM' && hours !== 12) hours += 12
    return { hours, minutes }
  }

  const match24 = trimmed.match(/^(\d{1,2}):(\d{2})$/)
  if (match24) {
    return { hours: Number.parseInt(match24[1], 10), minutes: Number.parseInt(match24[2], 10) }
  }

  return null
}

function normalizeDate(
  dateStr: string,
  timeStr?: string,
  lat?: number,
  lon?: number,
  profileTimezone?: string
): string | null {
  try {
    const parts = dateStr.trim().match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
    let year: number
    let month: number
    let day: number

    if (parts) {
      year = Number.parseInt(parts[1], 10)
      month = Number.parseInt(parts[2], 10) - 1
      day = Number.parseInt(parts[3], 10)
    } else {
      const fallback = new Date(dateStr)
      if (Number.isNaN(fallback.getTime())) return null
      year = fallback.getFullYear()
      month = fallback.getMonth()
      day = fallback.getDate()
    }

    let hours = 0
    let minutes = 0
    if (timeStr) {
      const parsed = parseTimeString(timeStr)
      if (parsed) {
        hours = parsed.hours
        minutes = parsed.minutes
      }
    }

    const pad = (value: number) => String(value).padStart(2, '0')
    const naiveStr = `${year}-${pad(month + 1)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00`

    if (profileTimezone && lat != null && lon != null) {
      return convertTimezones(naiveStr, profileTimezone, lat, lon)
    }

    const timezone =
      lat != null && lon != null ? getTimezoneFromCoords(lat, lon) : Intl.DateTimeFormat().resolvedOptions().timeZone
    const offset = getOffsetForLocalWallTime(timezone, year, month, day, hours, minutes)
    return `${naiveStr}${offset}`
  } catch {
    return null
  }
}

export function parseEBirdCSV(csvContent: string, profileTimezone?: string): ImportPreview[] {
  const lines = csvContent.split('\n').filter(line => line.trim())
  if (lines.length === 0) return []

  const headers = parseCSVLine(lines[0]).map(header => header.trim().toLowerCase())
  const previews: ImportPreview[] = []

  for (let index = 1; index < lines.length; index++) {
    const values = parseCSVLine(lines[index])
    const row: Record<string, string> = {}

    headers.forEach((header, headerIndex) => {
      row[header] = values[headerIndex] || ''
    })

    const speciesName = row['common name'] || row['species'] || row['species name']
    const scientificName = row['scientific name'] || row['species']
    const date = row['date'] || row['observation date'] || row['obs date']
    const location = row['location'] || row['location name'] || row['locality']
    const rawCount = (row['count'] || row['number'] || '').trim()
    const lat = Number.parseFloat(row['latitude'] || row['lat'] || '')
    const lon = Number.parseFloat(row['longitude'] || row['lon'] || row['lng'] || '')
    const time = row['time'] || row['start time'] || ''
    const submissionId = row['submission id'] || ''
    const stateProvince = row['state/province'] || row['state'] || ''
    const observationNotes = row['observation details'] || row['species comments'] || ''
    const checklistNotes = row['checklist comments'] || row['submission comments'] || ''

    if (speciesName && date) {
      const normalizedDate = normalizeDate(
        date,
        time,
        Number.isNaN(lat) ? undefined : lat,
        Number.isNaN(lon) ? undefined : lon,
        profileTimezone
      )
      if (!normalizedDate) continue

      const count = rawCount.toUpperCase() === 'X' ? 1 : Number.parseInt(rawCount || '1', 10)
      const fullName = scientificName && !speciesName.includes('(') ? `${speciesName} (${scientificName})` : speciesName

      previews.push({
        speciesName: fullName,
        date: normalizedDate,
        location: location || 'Unknown',
        count: Number.isNaN(count) ? 1 : count,
        lat: Number.isNaN(lat) ? undefined : lat,
        lon: Number.isNaN(lon) ? undefined : lon,
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

export function detectImportConflicts(
  previews: ImportPreview[],
  existingDex: Map<string, DexEntryForConflict>
): ImportPreview[] {
  const byDisplayName = new Map<string, DexEntryForConflict>()
  for (const entry of existingDex.values()) {
    byDisplayName.set(getDisplayName(entry.speciesName).toLowerCase(), entry)
  }

  return previews.map(preview => {
    const existing =
      existingDex.get(preview.speciesName) ?? byDisplayName.get(getDisplayName(preview.speciesName).toLowerCase())

    if (!existing) return { ...preview, conflict: 'new' }

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

export function groupPreviewsIntoOutings(
  previews: ImportPreview[],
  userId: string
): { outings: OutingForImport[]; observations: ObservationForImport[] } {
  const groups = new Map<string, ImportPreview[]>()
  const submissionIdCounts = new Map<string, number>()

  for (const preview of previews) {
    if (!preview.submissionId) continue
    submissionIdCounts.set(preview.submissionId, (submissionIdCounts.get(preview.submissionId) || 0) + 1)
  }

  for (const preview of previews) {
    const dateKey = preview.date.slice(0, 10)
    const key =
      preview.submissionId && (submissionIdCounts.get(preview.submissionId) || 0) > 1
        ? preview.submissionId
        : `${dateKey}||${preview.location}`

    const existing = groups.get(key)
    if (existing) existing.push(preview)
    else groups.set(key, [preview])
  }

  const outings: OutingForImport[] = []
  const observations: ObservationForImport[] = []

  for (const [, group] of groups) {
    const outingId = `outing_import_${crypto.randomUUID()}`
    const first = group[0]
    const startTime = first.date
    const dates = group.map(preview => new Date(preview.date).getTime())
    const latestDate = new Date(Math.max(...dates) + 3_600_000)
    const endTime =
      first.lat != null && first.lon != null
        ? dateToLocalISOWithOffset(latestDate, first.lat, first.lon)
        : latestDate.toISOString()

    const checklistNotes = first.checklistNotes || ''
    const outingNotes = checklistNotes ? `Imported from eBird – ${checklistNotes}` : 'Imported from eBird'

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

    const speciesMap = new Map<string, { count: number; notes: string }>()
    for (const preview of group) {
      const existing = speciesMap.get(preview.speciesName)
      if (existing) {
        existing.count += preview.count
        if (preview.observationNotes && !existing.notes.includes(preview.observationNotes)) {
          existing.notes = existing.notes ? `${existing.notes}; ${preview.observationNotes}` : preview.observationNotes
        }
      } else {
        speciesMap.set(preview.speciesName, { count: preview.count, notes: preview.observationNotes || '' })
      }
    }

    for (const [speciesName, info] of speciesMap) {
      observations.push({
        id: `obs_import_${crypto.randomUUID()}`,
        outingId,
        speciesName,
        count: info.count,
        certainty: 'confirmed',
        notes: info.notes,
      })
    }
  }

  return { outings, observations }
}

export function exportOutingToEBirdCSV(
  outing: OutingForExport,
  observations: ObservationForExport[],
  includeHeader = true
): string {
  const localMatch = outing.startTime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)

  const date = localMatch
    ? `${localMatch[2]}/${localMatch[3]}/${localMatch[1]}`
    : (() => {
        const parsed = new Date(outing.startTime)
        return `${String(parsed.getMonth() + 1).padStart(2, '0')}/${String(parsed.getDate()).padStart(2, '0')}/${parsed.getFullYear()}`
      })()

  const time = localMatch
    ? `${localMatch[4]}:${localMatch[5]}`
    : (() => {
        const parsed = new Date(outing.startTime)
        return `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`
      })()

  const rows = observations
    .filter(observation => observation.certainty === 'confirmed')
    .map(observation => {
      const commonName = sanitizeForEBird(getDisplayName(observation.speciesName))
      const scientificName = getScientificName(observation.speciesName) || ''
      const { genus, species } = splitScientificName(scientificName)

      return [
        commonName,
        genus,
        species,
        observation.count > 0 ? String(observation.count) : 'X',
        sanitizeForEBird(observation.notes || ''),
        sanitizeForEBird(outing.locationName),
        outing.lat != null ? outing.lat.toFixed(6) : '',
        outing.lon != null ? outing.lon.toFixed(6) : '',
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
        sanitizeForEBird(outing.notes || ''),
      ]
    })

  const csv = [
    ...(includeHeader ? [EBIRD_RECORD_HEADERS.join(',')] : []),
    ...rows.map(row => row.map(cell => csvEscape(cell)).join(',')),
  ].join('\n')

  return csv
}

export function exportDexToCSV(dex: DexEntryForExport[]): string {
  const headers = [
    'Common Name',
    'Scientific Name',
    'First Seen Date',
    'Last Seen Date',
    'Total Outings',
    'Total Count',
    'Notes',
  ]

  const rows = dex.map(entry => {
    const commonName = getDisplayName(entry.speciesName)
    const scientificName = getScientificName(entry.speciesName) || ''

    return [
      commonName,
      scientificName,
      formatISODate(entry.firstSeenDate),
      formatISODate(entry.lastSeenDate),
      String(entry.totalOutings),
      String(entry.totalCount),
      entry.notes || '',
    ]
  })

  return [headers.map(csvEscape).join(','), ...rows.map(row => row.map(csvEscape).join(','))].join('\n')
}
