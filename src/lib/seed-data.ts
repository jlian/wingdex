import { groupPreviewsIntoOutings, parseEBirdCSV } from './ebird'
import type { Outing, Observation, DexEntry } from './types'
import seedCsv from '../../e2e/fixtures/ebird-import.csv?raw'

function createSeedData(): { outings: Outing[]; observations: Observation[]; dex: DexEntry[] } {
  const previews = parseEBirdCSV(seedCsv)
  const grouped = groupPreviewsIntoOutings(previews, 'seed')

  const outingIdMap = new Map<string, string>()
  const outings: Outing[] = grouped.outings.map((outing, index) => {
    const id = `outing_seed_${index + 1}`
    outingIdMap.set(outing.id, id)
    return {
      ...outing,
      id,
      userId: 'seed',
    }
  })

  const observations: Observation[] = grouped.observations.map((observation, index) => ({
    ...observation,
    id: `obs_seed_${index + 1}`,
    outingId: outingIdMap.get(observation.outingId) || observation.outingId,
  }))

  const outingById = new Map(outings.map(outing => [outing.id, outing]))
  const bySpecies = new Map<string, { firstSeenDate: string; lastSeenDate: string; addedDate: string; totalCount: number; outingIds: Set<string> }>()

  for (const observation of observations) {
    if (observation.certainty !== 'confirmed') continue
    const outing = outingById.get(observation.outingId)
    if (!outing) continue

    const existing = bySpecies.get(observation.speciesName)
    if (!existing) {
      bySpecies.set(observation.speciesName, {
        firstSeenDate: outing.startTime,
        lastSeenDate: outing.startTime,
        addedDate: outing.startTime,
        totalCount: observation.count,
        outingIds: new Set([outing.id]),
      })
      continue
    }

    if (new Date(outing.startTime).getTime() < new Date(existing.firstSeenDate).getTime()) {
      existing.firstSeenDate = outing.startTime
      existing.addedDate = outing.startTime
    }
    if (new Date(outing.startTime).getTime() > new Date(existing.lastSeenDate).getTime()) {
      existing.lastSeenDate = outing.startTime
    }
    existing.totalCount += observation.count
    existing.outingIds.add(outing.id)
  }

  const dex: DexEntry[] = Array.from(bySpecies.entries())
    .map(([speciesName, summary]) => ({
      speciesName,
      firstSeenDate: summary.firstSeenDate,
      lastSeenDate: summary.lastSeenDate,
      addedDate: summary.addedDate,
      totalOutings: summary.outingIds.size,
      totalCount: summary.totalCount,
      notes: '',
    }))
    .sort((a, b) => a.speciesName.localeCompare(b.speciesName))

  return { outings, observations, dex }
}

const seedData = createSeedData()

export const SEED_OUTINGS: Outing[] = seedData.outings
export const SEED_OBSERVATIONS: Observation[] = seedData.observations
export const SEED_DEX: DexEntry[] = seedData.dex
