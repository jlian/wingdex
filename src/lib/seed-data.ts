import type { Outing, Observation, DexEntry } from './types'

// ─── Seed Data ──────────────────────────────────────────
// Realistic demo data for development and testing.
// Uses species names that Wikipedia can resolve for images.

const now = Date.now()
const day = 86400000
const hour = 3600000

function id(prefix: string, n: number) {
  return `${prefix}_seed_${n}`
}

export const SEED_OUTINGS: Outing[] = [
  {
    id: id('outing', 1),
    userId: 'seed',
    startTime: new Date(now - 2 * day).toISOString(),
    endTime: new Date(now - 2 * day + 2 * hour).toISOString(),
    locationName: 'Central Park, New York',
    lat: 40.7829,
    lon: -73.9654,
    notes: 'Beautiful morning walk along the lake. Lots of activity near the feeders.',
    createdAt: new Date(now - 2 * day).toISOString(),
  },
  {
    id: id('outing', 2),
    userId: 'seed',
    startTime: new Date(now - 8 * day).toISOString(),
    endTime: new Date(now - 8 * day + 3 * hour).toISOString(),
    locationName: 'Jamaica Bay Wildlife Refuge',
    lat: 40.6172,
    lon: -73.8253,
    notes: 'Saw a bald eagle soaring over the bay! Great heron activity in the marshes.',
    createdAt: new Date(now - 8 * day).toISOString(),
  },
  {
    id: id('outing', 3),
    userId: 'seed',
    startTime: new Date(now - 15 * day).toISOString(),
    endTime: new Date(now - 15 * day + 1.5 * hour).toISOString(),
    locationName: 'Prospect Park, Brooklyn',
    lat: 40.6602,
    lon: -73.9690,
    notes: 'Quick lunchtime birding. The woodpeckers were very active today.',
    createdAt: new Date(now - 15 * day).toISOString(),
  },
  {
    id: id('outing', 4),
    userId: 'seed',
    startTime: new Date(now - 30 * day).toISOString(),
    endTime: new Date(now - 30 * day + 4 * hour).toISOString(),
    locationName: 'Bear Mountain State Park',
    lat: 41.3126,
    lon: -73.9887,
    notes: 'Trail hike with incredible raptor sightings at the summit.',
    createdAt: new Date(now - 30 * day).toISOString(),
  },
  {
    id: id('outing', 5),
    userId: 'seed',
    startTime: new Date(now - 45 * day).toISOString(),
    endTime: new Date(now - 45 * day + 2 * hour).toISOString(),
    locationName: 'Riverside Park, Manhattan',
    lat: 40.8008,
    lon: -73.9725,
    notes: '',
    createdAt: new Date(now - 45 * day).toISOString(),
  },
]

const speciesData: Array<{
  name: string
  outings: number[]     // indices into SEED_OUTINGS
  counts: number[]      // count per outing
  certainty: 'confirmed' | 'possible'
}> = [
  { name: 'Northern Cardinal',           outings: [0, 2, 4], counts: [2, 1, 3], certainty: 'confirmed' },
  { name: 'Blue Jay',                    outings: [0, 2],     counts: [3, 2],    certainty: 'confirmed' },
  { name: 'American Robin',              outings: [0, 2, 4], counts: [5, 3, 4], certainty: 'confirmed' },
  { name: 'Red-tailed Hawk',             outings: [1, 3],     counts: [1, 2],    certainty: 'confirmed' },
  { name: 'Great Blue Heron',            outings: [1],        counts: [2],       certainty: 'confirmed' },
  { name: 'Ruby-throated Hummingbird',   outings: [0],        counts: [1],       certainty: 'confirmed' },
  { name: 'Bald Eagle',                  outings: [1],        counts: [1],       certainty: 'confirmed' },
  { name: 'American Goldfinch',          outings: [0, 4],     counts: [4, 2],    certainty: 'confirmed' },
  { name: 'Downy Woodpecker',            outings: [2, 3],     counts: [1, 1],    certainty: 'confirmed' },
  { name: 'Eastern Bluebird',            outings: [3],        counts: [3],       certainty: 'confirmed' },
  { name: 'Black-capped Chickadee',      outings: [2, 4],     counts: [4, 2],    certainty: 'confirmed' },
  { name: 'Mourning Dove',               outings: [0, 2, 4], counts: [2, 1, 3], certainty: 'confirmed' },
  { name: 'House Finch',                 outings: [0, 4],     counts: [3, 2],    certainty: 'confirmed' },
  { name: 'White-breasted Nuthatch',     outings: [2, 3],     counts: [1, 2],    certainty: 'confirmed' },
  { name: 'Red-winged Blackbird',        outings: [1, 4],     counts: [6, 3],    certainty: 'confirmed' },
  { name: 'Cooper\'s Hawk',              outings: [3],        counts: [1],       certainty: 'possible' },
  { name: 'Cedar Waxwing',               outings: [3],        counts: [8],       certainty: 'confirmed' },
  { name: 'Tufted Titmouse',             outings: [2],        counts: [2],       certainty: 'confirmed' },
]

let obsCounter = 0

export const SEED_OBSERVATIONS: Observation[] = speciesData.flatMap(sp =>
  sp.outings.map((outingIdx, i) => ({
    id: id('obs', ++obsCounter),
    outingId: SEED_OUTINGS[outingIdx].id,
    speciesName: sp.name,
    count: sp.counts[i],
    certainty: sp.certainty as 'confirmed' | 'possible',
    notes: '',
  }))
)

// Build dex from observations
function buildDex(): DexEntry[] {
  const map = new Map<string, DexEntry>()

  for (const obs of SEED_OBSERVATIONS) {
    if (obs.certainty !== 'confirmed') continue
    const outing = SEED_OUTINGS.find(o => o.id === obs.outingId)!
    const existing = map.get(obs.speciesName)
    const outingDate = new Date(outing.startTime)

    if (existing) {
      const firstDate = new Date(existing.firstSeenDate)
      const lastDate = new Date(existing.lastSeenDate)
      map.set(obs.speciesName, {
        ...existing,
        firstSeenDate: outingDate < firstDate ? outing.startTime : existing.firstSeenDate,
        lastSeenDate: outingDate > lastDate ? outing.startTime : existing.lastSeenDate,
        totalOutings: existing.totalOutings + 1,
        totalCount: existing.totalCount + obs.count,
      })
    } else {
      map.set(obs.speciesName, {
        speciesName: obs.speciesName,
        firstSeenDate: outing.startTime,
        lastSeenDate: outing.startTime,
        addedDate: outing.startTime,
        totalOutings: 1,
        totalCount: obs.count,
        notes: '',
      })
    }
  }

  return Array.from(map.values()).sort((a, b) => a.speciesName.localeCompare(b.speciesName))
}

export const SEED_DEX: DexEntry[] = buildDex()
