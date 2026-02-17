import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEBirdCSV, groupPreviewsIntoOutings } from '../src/lib/ebird'
import type { Outing, Observation, DexEntry } from '../src/lib/types'

const PRIVATE_LOCATION_PATTERNS = [/\bhome\b/i, /\bparent/i]
const PRIVATE_COORDINATES = [
  { lat: 47.639918, lon: -122.403887 }, // Home
  { lat: 49.316781, lon: -122.864568 }, // Parent's
]
const PRIVATE_RADIUS_KM = 2

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const earthRadiusKm = 6371
  const toRad = (deg: number) => deg * (Math.PI / 180)
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadiusKm * c
}

function isSensitiveRecord(location: string, lat?: number, lon?: number): boolean {
  if (PRIVATE_LOCATION_PATTERNS.some((pattern) => pattern.test(location))) {
    return true
  }

  if (typeof lat !== 'number' || typeof lon !== 'number') {
    return false
  }

  return PRIVATE_COORDINATES.some((coord) =>
    haversineKm(lat, lon, coord.lat, coord.lon) <= PRIVATE_RADIUS_KM
  )
}

function buildDex(outings: Outing[], observations: Observation[]): DexEntry[] {
  const outingsById = new Map(outings.map((outing) => [outing.id, outing]))
  const grouped = new Map<string, Observation[]>()

  for (const observation of observations) {
    if (observation.certainty !== 'confirmed') continue
    const existing = grouped.get(observation.speciesName)
    if (existing) {
      existing.push(observation)
    } else {
      grouped.set(observation.speciesName, [observation])
    }
  }

  const entries: DexEntry[] = []
  for (const [speciesName, group] of grouped.entries()) {
    const speciesOutings = group
      .map((obs) => outingsById.get(obs.outingId))
      .filter((outing): outing is Outing => !!outing)
    if (speciesOutings.length === 0) continue

    const firstSeen = speciesOutings.reduce((min, current) =>
      new Date(current.startTime) < new Date(min.startTime) ? current : min
    )
    const lastSeen = speciesOutings.reduce((max, current) =>
      new Date(current.startTime) > new Date(max.startTime) ? current : max
    )

    entries.push({
      speciesName,
      firstSeenDate: firstSeen.startTime,
      lastSeenDate: lastSeen.startTime,
      addedDate: firstSeen.startTime,
      totalOutings: new Set(group.map((obs) => obs.outingId)).size,
      totalCount: group.reduce((sum, obs) => sum + obs.count, 0),
      notes: '',
    })
  }

  return entries.sort((a, b) => a.speciesName.localeCompare(b.speciesName))
}

/**
 * Builds localStorage seed entries from a sanitized eBird CSV fixture.
 *
 * Privacy filtering removes records with sensitive location names
 * (e.g. Home / Parent) and rows within 2km of known private coordinates.
 *
 * Keyed for userId=1 (the dev-user fallback).
 */
export function buildSeedLocalStorage(): Record<string, string> {
  const prefix = 'wingdex_kv_u1_'

  const fixturePath = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'ebird-import.csv')
  const csv = readFileSync(fixturePath, 'utf8')
  const previews = parseEBirdCSV(csv)
  const safePreviews = previews.filter((preview) =>
    !isSensitiveRecord(preview.location, preview.lat, preview.lon)
  )

  const grouped = groupPreviewsIntoOutings(safePreviews, 'seed')

  const outings: Outing[] = grouped.outings.map((outing, index) => ({
    ...outing,
    id: `outing_seed_${index + 1}`,
  }))

  const outingIdMap = new Map(grouped.outings.map((outing, index) => [outing.id, outings[index].id]))
  const observations: Observation[] = grouped.observations.map((observation, index) => ({
    ...observation,
    id: `obs_seed_${index + 1}`,
    outingId: outingIdMap.get(observation.outingId) || observation.outingId,
  }))

  const dex = buildDex(outings, observations)

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
