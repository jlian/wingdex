import type { Outing, Observation, ImportPreview, DexEntry } from './types'
import { getDisplayName, getScientificName } from './utils'

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
 * Records sharing the same date + location become one outing.
 */
export function groupPreviewsIntoOutings(
  previews: ImportPreview[],
  userId: string
): { outings: Outing[]; observations: Observation[] } {
  // Key by date (YYYY-MM-DD) + location
  const groups = new Map<string, ImportPreview[]>()
  for (const p of previews) {
    const dateKey = new Date(p.date).toISOString().split('T')[0]
    const key = `${dateKey}||${p.location}`
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
    // Use latest record time or +1h as endTime
    const dates = group.map(p => new Date(p.date).getTime())
    const endTime = new Date(Math.max(...dates) + 3600000).toISOString()

    outings.push({
      id: outingId,
      userId,
      startTime,
      endTime,
      locationName: first.location,
      defaultLocationName: first.location,
      lat: first.lat,
      lon: first.lon,
      notes: 'Imported from eBird',
      createdAt: new Date().toISOString(),
    })

    // Deduplicate species within the group
    const speciesMap = new Map<string, { count: number }>()
    for (const p of group) {
      const existing = speciesMap.get(p.speciesName)
      if (existing) {
        existing.count += p.count
      } else {
        speciesMap.set(p.speciesName, { count: p.count })
      }
    }

    for (const [species, info] of speciesMap) {
      observations.push({
        id: `obs_import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        outingId,
        speciesName: species,
        count: info.count,
        certainty: 'confirmed',
        notes: '',
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

  const outingDate = new Date(outing.startTime)
  const date = `${String(outingDate.getMonth() + 1).padStart(2, '0')}/${String(outingDate.getDate()).padStart(2, '0')}/${outingDate.getFullYear()}`
  const time = `${String(outingDate.getHours()).padStart(2, '0')}:${String(outingDate.getMinutes()).padStart(2, '0')}`

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
        obs.count > 0 ? String(obs.count) : 'X',
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
    const count = parseInt(row['count'] || row['number'] || '1', 10)
    const lat = parseFloat(row['latitude'] || row['lat'] || '')
    const lon = parseFloat(row['longitude'] || row['lon'] || row['lng'] || '')
    const time = row['time'] || row['start time'] || ''
    
    if (speciesName && date) {
      const normalizedDate = normalizeDate(date)
      if (!normalizedDate) continue

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

function normalizeDate(dateStr: string): string | null {
  try {
    const date = new Date(dateStr)
    if (!isNaN(date.getTime())) {
      return date.toISOString()
    }
  } catch {
    
  }
  return null
}

export function detectImportConflicts(
  previews: ImportPreview[],
  existingDex: Map<string, DexEntry>
): ImportPreview[] {
  return previews.map(preview => {
    const existing = existingDex.get(preview.speciesName)
    
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
    'Species Name',
    'First Seen Date',
    'Last Seen Date',
    'Total Outings',
    'Total Count',
    'Notes'
  ]
  
  const rows = dex.map(entry => [
    entry.speciesName,
    new Date(entry.firstSeenDate).toLocaleDateString(),
    new Date(entry.lastSeenDate).toLocaleDateString(),
    entry.totalOutings.toString(),
    entry.totalCount.toString(),
    entry.notes || ''
  ])
  
  const csv = [
    headers.join(','),
    ...rows.map(row => row.map(cell => csvEscape(cell)).join(','))
  ].join('\n')
  
  return csv
}
