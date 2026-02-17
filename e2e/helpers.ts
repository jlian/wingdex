import type { Page } from '@playwright/test'

/**
 * Builds a full set of localStorage entries that seed the app with
 * realistic bird-watching data (5 outings, 18 species, ~30 observations).
 *
 * Keyed for userId=1 (the dev-user fallback).
 */
export function buildSeedLocalStorage(): Record<string, string> {
  const now = Date.now()
  const day = 86400000
  const hour = 3600000
  const prefix = 'wingdex_kv_u1_'

  const outings = [
    { id: 'outing_seed_1', userId: 'seed', startTime: new Date(now - 2 * day).toISOString(), endTime: new Date(now - 2 * day + 2 * hour).toISOString(), locationName: 'Central Park, New York', lat: 40.7829, lon: -73.9654, notes: 'Beautiful morning walk along the lake.', createdAt: new Date(now - 2 * day).toISOString() },
    { id: 'outing_seed_2', userId: 'seed', startTime: new Date(now - 8 * day).toISOString(), endTime: new Date(now - 8 * day + 3 * hour).toISOString(), locationName: 'Jamaica Bay Wildlife Refuge', lat: 40.6172, lon: -73.8253, notes: 'Saw a bald eagle soaring!', createdAt: new Date(now - 8 * day).toISOString() },
    { id: 'outing_seed_3', userId: 'seed', startTime: new Date(now - 15 * day).toISOString(), endTime: new Date(now - 15 * day + 1.5 * hour).toISOString(), locationName: 'Prospect Park, Brooklyn', lat: 40.6602, lon: -73.9690, notes: 'Quick lunchtime birding.', createdAt: new Date(now - 15 * day).toISOString() },
    { id: 'outing_seed_4', userId: 'seed', startTime: new Date(now - 30 * day).toISOString(), endTime: new Date(now - 30 * day + 4 * hour).toISOString(), locationName: 'Bear Mountain State Park', lat: 41.3126, lon: -73.9887, notes: 'Incredible raptor sightings.', createdAt: new Date(now - 30 * day).toISOString() },
    { id: 'outing_seed_5', userId: 'seed', startTime: new Date(now - 45 * day).toISOString(), endTime: new Date(now - 45 * day + 2 * hour).toISOString(), locationName: 'Riverside Park, Manhattan', lat: 40.8008, lon: -73.9725, notes: '', createdAt: new Date(now - 45 * day).toISOString() },
  ]

  const speciesData = [
    { name: 'Northern Cardinal', outings: [0, 2, 4], counts: [2, 1, 3], certainty: 'confirmed' as const },
    { name: 'Blue Jay', outings: [0, 2], counts: [3, 2], certainty: 'confirmed' as const },
    { name: 'American Robin', outings: [0, 2, 4], counts: [5, 3, 4], certainty: 'confirmed' as const },
    { name: 'Red-tailed Hawk', outings: [1, 3], counts: [1, 2], certainty: 'confirmed' as const },
    { name: 'Great Blue Heron', outings: [1], counts: [2], certainty: 'confirmed' as const },
    { name: 'Ruby-throated Hummingbird', outings: [0], counts: [1], certainty: 'confirmed' as const },
    { name: 'Bald Eagle', outings: [1], counts: [1], certainty: 'confirmed' as const },
    { name: 'American Goldfinch', outings: [0, 4], counts: [4, 2], certainty: 'confirmed' as const },
    { name: 'Downy Woodpecker', outings: [2, 3], counts: [1, 1], certainty: 'confirmed' as const },
    { name: 'Eastern Bluebird', outings: [3], counts: [3], certainty: 'confirmed' as const },
    { name: 'Black-capped Chickadee', outings: [2, 4], counts: [4, 2], certainty: 'confirmed' as const },
    { name: 'Mourning Dove', outings: [0, 2, 4], counts: [2, 1, 3], certainty: 'confirmed' as const },
    { name: 'House Finch', outings: [0, 4], counts: [3, 2], certainty: 'confirmed' as const },
    { name: 'White-breasted Nuthatch', outings: [2, 3], counts: [1, 2], certainty: 'confirmed' as const },
    { name: 'Red-winged Blackbird', outings: [1, 4], counts: [6, 3], certainty: 'confirmed' as const },
    { name: "Cooper's Hawk", outings: [3], counts: [1], certainty: 'possible' as const },
    { name: 'Cedar Waxwing', outings: [3], counts: [8], certainty: 'confirmed' as const },
    { name: 'Tufted Titmouse', outings: [2], counts: [2], certainty: 'confirmed' as const },
  ]

  let obsCounter = 0
  const observations = speciesData.flatMap(sp =>
    sp.outings.map((outingIdx, i) => ({
      id: `obs_seed_${++obsCounter}`,
      outingId: outings[outingIdx].id,
      speciesName: sp.name,
      count: sp.counts[i],
      certainty: sp.certainty,
      notes: '',
    }))
  )

  // Build dex
  const dexMap = new Map<string, any>()
  for (const obs of observations) {
    if (obs.certainty !== 'confirmed') continue
    const outing = outings.find(o => o.id === obs.outingId)!
    const existing = dexMap.get(obs.speciesName)
    const outingDate = new Date(outing.startTime)
    if (existing) {
      dexMap.set(obs.speciesName, {
        ...existing,
        firstSeenDate: outingDate < new Date(existing.firstSeenDate) ? outing.startTime : existing.firstSeenDate,
        lastSeenDate: outingDate > new Date(existing.lastSeenDate) ? outing.startTime : existing.lastSeenDate,
        totalOutings: existing.totalOutings + 1,
        totalCount: existing.totalCount + obs.count,
      })
    } else {
      dexMap.set(obs.speciesName, {
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
  const dex = Array.from(dexMap.values()).sort((a: any, b: any) => a.speciesName.localeCompare(b.speciesName))

  return {
    [`${prefix}outings`]: JSON.stringify(outings),
    [`${prefix}observations`]: JSON.stringify(observations),
    [`${prefix}dex`]: JSON.stringify(dex),
    [`${prefix}photos`]: JSON.stringify([]),
    [`${prefix}savedSpots`]: JSON.stringify([]),
  }
}

/**
 * Injects seed data into localStorage and reloads.
 * Call at the start of any test that needs a populated app state.
 */
export async function injectSeedData(page: Page) {
  const seedData = buildSeedLocalStorage()
  await page.goto('/')
  await page.evaluate((data) => {
    // Force the dev user ID to 1 so it matches our seed key prefix (u1_)
    localStorage.setItem('wingdex_dev_user_id', '1')
    for (const [key, value] of Object.entries(data)) {
      localStorage.setItem(key, value)
    }
  }, seedData)
  await page.reload()
  await page.waitForSelector('text=WingDex', { timeout: 10000 })
}
