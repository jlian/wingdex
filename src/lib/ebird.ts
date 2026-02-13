import type { Outing, Observation, ImportPreview, LifeListEntry } from './types'
import { getDisplayName, getScientificName } from './utils'

export function exportOutingToEBirdCSV(
  outing: Outing,
  observations: Observation[]
): string {
  const headers = [
    'Common Name',
    'Species',
    'Count',
    'Location',
    'Latitude',
    'Longitude',
    'Date',
    'Time',
    'Protocol',
    'Comments'
  ]
  
  const rows = observations
    .filter(obs => obs.certainty === 'confirmed')
    .map(obs => {
      const species = getDisplayName(obs.speciesName)
      const scientific = getScientificName(obs.speciesName) || ''
      
      const date = new Date(outing.startTime).toLocaleDateString('en-US')
      const time = new Date(outing.startTime).toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
      })
      
      return [
        species,
        scientific,
        obs.count.toString(),
        outing.locationName,
        outing.lat?.toFixed(6) || '',
        outing.lon?.toFixed(6) || '',
        date,
        time,
        'Incidental',
        obs.notes || outing.notes || ''
      ]
    })
  
  const csv = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n')
  
  return csv
}

export function parseEBirdCSV(csvContent: string): ImportPreview[] {
  const lines = csvContent.split('\n').filter(line => line.trim())
  if (lines.length === 0) return []
  
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase())
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
    
    if (speciesName && date) {
      const fullName = scientificName && !speciesName.includes('(')
        ? `${speciesName} (${scientificName})`
        : speciesName
      
      previews.push({
        speciesName: fullName,
        date: normalizeDate(date),
        location: location || 'Unknown',
        count: isNaN(count) ? 1 : count
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
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  
  values.push(current.trim())
  return values
}

function normalizeDate(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    if (!isNaN(date.getTime())) {
      return date.toISOString()
    }
  } catch {
    
  }
  return new Date().toISOString()
}

export function detectImportConflicts(
  previews: ImportPreview[],
  existingLifeList: Map<string, LifeListEntry>
): ImportPreview[] {
  return previews.map(preview => {
    const existing = existingLifeList.get(preview.speciesName)
    
    if (!existing) {
      return { ...preview, conflict: 'new' }
    }
    
    const previewDate = new Date(preview.date)
    const firstSeen = new Date(existing.firstSeenDate)
    const lastSeen = new Date(existing.lastSeenDate)
    
    if (
      previewDate.toDateString() === firstSeen.toDateString() &&
      preview.location === existing.notes
    ) {
      return { ...preview, conflict: 'duplicate', existingEntry: existing }
    }
    
    if (previewDate < firstSeen || previewDate > lastSeen) {
      return { ...preview, conflict: 'update_dates', existingEntry: existing }
    }
    
    return { ...preview, conflict: 'new', existingEntry: existing }
  })
}

export function exportLifeListToCSV(lifeList: LifeListEntry[]): string {
  const headers = [
    'Species Name',
    'First Seen Date',
    'Last Seen Date',
    'Total Outings',
    'Total Count',
    'Notes'
  ]
  
  const rows = lifeList.map(entry => [
    entry.speciesName,
    new Date(entry.firstSeenDate).toLocaleDateString(),
    new Date(entry.lastSeenDate).toLocaleDateString(),
    entry.totalOutings.toString(),
    entry.totalCount.toString(),
    entry.notes || ''
  ])
  
  const csv = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n')
  
  return csv
}
