import { Octokit } from 'octokit'
import type { BirdDexData, GistSyncSettings } from './types'

const GIST_FILENAME = 'birddex-data.json'
const GIST_DESCRIPTION = 'BirdDex Life List & Sighting Data'

export class GistSyncService {
  private octokit: Octokit | null = null

  async initialize(token: string) {
    this.octokit = new Octokit({ auth: token })
  }

  async createGist(data: BirdDexData, isPublic: boolean): Promise<string> {
    if (!this.octokit) {
      throw new Error('Octokit not initialized. Call initialize() first.')
    }

    const response = await this.octokit.rest.gists.create({
      description: GIST_DESCRIPTION,
      public: isPublic,
      files: {
        [GIST_FILENAME]: {
          content: JSON.stringify(data, null, 2)
        }
      }
    })

    if (!response.data.id) {
      throw new Error('Failed to create gist')
    }

    return response.data.id
  }

  async updateGist(gistId: string, data: BirdDexData): Promise<void> {
    if (!this.octokit) {
      throw new Error('Octokit not initialized. Call initialize() first.')
    }

    await this.octokit.rest.gists.update({
      gist_id: gistId,
      files: {
        [GIST_FILENAME]: {
          content: JSON.stringify(data, null, 2)
        }
      }
    })
  }

  async getGist(gistId: string): Promise<BirdDexData> {
    if (!this.octokit) {
      throw new Error('Octokit not initialized. Call initialize() first.')
    }

    const response = await this.octokit.rest.gists.get({
      gist_id: gistId
    })

    const file = response.data.files?.[GIST_FILENAME]
    if (!file || !file.content) {
      throw new Error('Gist file not found or empty')
    }

    return JSON.parse(file.content)
  }

  async deleteGist(gistId: string): Promise<void> {
    if (!this.octokit) {
      throw new Error('Octokit not initialized. Call initialize() first.')
    }

    await this.octokit.rest.gists.delete({
      gist_id: gistId
    })
  }

  async updateGistVisibility(gistId: string, isPublic: boolean): Promise<void> {
    if (!this.octokit) {
      throw new Error('Octokit not initialized. Call initialize() first.')
    }

    await this.octokit.rest.gists.update({
      gist_id: gistId,
      public: isPublic
    })
  }

  async listGists(): Promise<Array<{ id: string; description: string; public: boolean; updated_at: string }>> {
    if (!this.octokit) {
      throw new Error('Octokit not initialized. Call initialize() first.')
    }

    const response = await this.octokit.rest.gists.list({
      per_page: 100
    })

    return response.data
      .filter(gist => gist.description?.includes('BirdDex'))
      .map(gist => ({
        id: gist.id,
        description: gist.description || '',
        public: gist.public,
        updated_at: gist.updated_at || ''
      }))
  }
}

export async function createBirdDexExport(data: {
  photos: any[]
  outings: any[]
  observations: any[]
  lifeList: any[]
  savedSpots: any[]
}): Promise<BirdDexData> {
  return {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    photos: data.photos,
    outings: data.outings,
    observations: data.observations,
    lifeList: data.lifeList,
    savedSpots: data.savedSpots
  }
}

export function mergeImportedData(
  local: BirdDexData,
  remote: BirdDexData
): BirdDexData {
  const mergedPhotos = new Map(local.photos.map(p => [p.id, p]))
  remote.photos.forEach(p => {
    if (!mergedPhotos.has(p.id)) {
      mergedPhotos.set(p.id, p)
    }
  })

  const mergedOutings = new Map(local.outings.map(o => [o.id, o]))
  remote.outings.forEach(o => {
    if (!mergedOutings.has(o.id)) {
      mergedOutings.set(o.id, o)
    }
  })

  const mergedObservations = new Map(local.observations.map(obs => [obs.id, obs]))
  remote.observations.forEach(obs => {
    if (!mergedObservations.has(obs.id)) {
      mergedObservations.set(obs.id, obs)
    }
  })

  const mergedLifeList = new Map(local.lifeList.map(entry => [entry.speciesName, entry]))
  remote.lifeList.forEach(entry => {
    const existing = mergedLifeList.get(entry.speciesName)
    if (existing) {
      const existingFirst = new Date(existing.firstSeenDate)
      const existingLast = new Date(existing.lastSeenDate)
      const entryFirst = new Date(entry.firstSeenDate)
      const entryLast = new Date(entry.lastSeenDate)

      mergedLifeList.set(entry.speciesName, {
        ...existing,
        firstSeenDate: entryFirst < existingFirst ? entry.firstSeenDate : existing.firstSeenDate,
        lastSeenDate: entryLast > existingLast ? entry.lastSeenDate : existing.lastSeenDate,
        totalOutings: Math.max(existing.totalOutings, entry.totalOutings),
        totalCount: Math.max(existing.totalCount, entry.totalCount),
        bestPhotoId: entry.bestPhotoId || existing.bestPhotoId,
        notes: entry.notes || existing.notes
      })
    } else {
      mergedLifeList.set(entry.speciesName, entry)
    }
  })

  const mergedSpots = new Map(local.savedSpots.map(s => [s.id, s]))
  remote.savedSpots.forEach(s => {
    if (!mergedSpots.has(s.id)) {
      mergedSpots.set(s.id, s)
    }
  })

  return {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    photos: Array.from(mergedPhotos.values()),
    outings: Array.from(mergedOutings.values()),
    observations: Array.from(mergedObservations.values()),
    lifeList: Array.from(mergedLifeList.values()).sort((a, b) =>
      a.speciesName.localeCompare(b.speciesName)
    ),
    savedSpots: Array.from(mergedSpots.values())
  }
}
