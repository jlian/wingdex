type OutingForExport = {
  id: string
  startTime: string
  locationName: string
  lat?: number | null
  lon?: number | null
  notes?: string | null
}

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
