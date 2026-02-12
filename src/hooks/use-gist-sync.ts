import { useState, useCallback } from 'react'
import { useKV } from '@github/spark/hooks'
import { GistSyncService, createBirdDexExport, mergeImportedData } from '@/lib/gist-sync'
import type { GistSyncSettings, BirdDexData } from '@/lib/types'
import { toast } from 'sonner'

export function useGistSync() {
  const [syncSettings, setSyncSettings] = useKV<GistSyncSettings>('gist-sync-settings', {
    enabled: false,
    isPublic: false,
    autoSync: false
  })

  const [githubToken, setGithubToken] = useKV<string>('github-token', '')
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncService] = useState(() => new GistSyncService())

  const initializeService = useCallback(async () => {
    if (!githubToken) {
      throw new Error('GitHub token not configured')
    }
    await syncService.initialize(githubToken)
  }, [githubToken, syncService])

  const enableSync = useCallback(async (isPublic: boolean, token: string) => {
    try {
      setIsSyncing(true)
      setGithubToken(token)
      await syncService.initialize(token)
      
      setSyncSettings(current => ({
        enabled: true,
        isPublic,
        autoSync: current?.autoSync || false,
        gistId: current?.gistId,
        lastSyncTime: current?.lastSyncTime
      }))

      toast.success('GitHub sync enabled')
    } catch (error) {
      toast.error('Failed to enable sync: ' + (error as Error).message)
      throw error
    } finally {
      setIsSyncing(false)
    }
  }, [syncService, setSyncSettings, setGithubToken])

  const disableSync = useCallback(async (deleteGist: boolean = false) => {
    try {
      setIsSyncing(true)
      
      if (deleteGist && syncSettings?.gistId) {
        await initializeService()
        await syncService.deleteGist(syncSettings.gistId)
      }

      setSyncSettings({
        enabled: false,
        isPublic: false,
        autoSync: false
      })

      toast.success(deleteGist ? 'Sync disabled and gist deleted' : 'Sync disabled')
    } catch (error) {
      toast.error('Failed to disable sync: ' + (error as Error).message)
      throw error
    } finally {
      setIsSyncing(false)
    }
  }, [syncSettings, syncService, initializeService, setSyncSettings])

  const pushToGist = useCallback(async (data: {
    photos: any[]
    outings: any[]
    observations: any[]
    lifeList: any[]
    savedSpots: any[]
  }) => {
    if (!syncSettings?.enabled) {
      throw new Error('Gist sync not enabled')
    }

    try {
      setIsSyncing(true)
      await initializeService()

      const exportData = await createBirdDexExport(data)

      if (syncSettings.gistId) {
        await syncService.updateGist(syncSettings.gistId, exportData)
        setSyncSettings(current => ({
          enabled: current?.enabled || false,
          isPublic: current?.isPublic || false,
          autoSync: current?.autoSync || false,
          gistId: current?.gistId,
          lastSyncTime: new Date().toISOString()
        }))
      } else {
        const gistId = await syncService.createGist(exportData, syncSettings.isPublic)
        setSyncSettings(current => ({
          enabled: current?.enabled || false,
          isPublic: current?.isPublic || false,
          autoSync: current?.autoSync || false,
          gistId,
          lastSyncTime: new Date().toISOString()
        }))
      }

      toast.success('Synced to GitHub')
    } catch (error) {
      toast.error('Failed to push to GitHub: ' + (error as Error).message)
      throw error
    } finally {
      setIsSyncing(false)
    }
  }, [syncSettings, syncService, initializeService, setSyncSettings])

  const pullFromGist = useCallback(async (): Promise<BirdDexData | null> => {
    if (!syncSettings?.enabled || !syncSettings.gistId) {
      throw new Error('Gist sync not enabled or no gist ID')
    }

    try {
      setIsSyncing(true)
      await initializeService()

      const data = await syncService.getGist(syncSettings.gistId)
      
      setSyncSettings({
        enabled: syncSettings.enabled,
        isPublic: syncSettings.isPublic,
        autoSync: syncSettings.autoSync,
        gistId: syncSettings.gistId,
        lastSyncTime: new Date().toISOString()
      })

      toast.success('Pulled from GitHub')
      return data
    } catch (error) {
      toast.error('Failed to pull from GitHub: ' + (error as Error).message)
      throw error
    } finally {
      setIsSyncing(false)
    }
  }, [syncSettings, syncService, initializeService, setSyncSettings])

  const updateVisibility = useCallback(async (isPublic: boolean) => {
    if (!syncSettings?.enabled || !syncSettings.gistId) {
      throw new Error('Gist sync not enabled or no gist ID')
    }

    try {
      setIsSyncing(true)
      await initializeService()
      await syncService.updateGistVisibility(syncSettings.gistId, isPublic)
      
      setSyncSettings({
        enabled: syncSettings.enabled,
        isPublic,
        autoSync: syncSettings.autoSync,
        gistId: syncSettings.gistId,
        lastSyncTime: syncSettings.lastSyncTime
      })

      toast.success(`Gist is now ${isPublic ? 'public' : 'private'}`)
    } catch (error) {
      toast.error('Failed to update visibility: ' + (error as Error).message)
      throw error
    } finally {
      setIsSyncing(false)
    }
  }, [syncSettings, syncService, initializeService, setSyncSettings])

  const toggleAutoSync = useCallback(() => {
    setSyncSettings(current => {
      if (!current) return { enabled: false, isPublic: false, autoSync: false }
      return {
        enabled: current.enabled,
        isPublic: current.isPublic,
        autoSync: !current.autoSync,
        gistId: current.gistId,
        lastSyncTime: current.lastSyncTime
      }
    })
  }, [setSyncSettings])

  const findExistingGists = useCallback(async (token: string) => {
    try {
      await syncService.initialize(token)
      return await syncService.listGists()
    } catch (error) {
      toast.error('Failed to list gists: ' + (error as Error).message)
      throw error
    }
  }, [syncService])

  const connectToExistingGist = useCallback(async (gistId: string, token: string) => {
    try {
      setIsSyncing(true)
      setGithubToken(token)
      await syncService.initialize(token)
      
      const gist = await syncService.getGist(gistId)
      
      setSyncSettings({
        enabled: true,
        gistId,
        isPublic: false,
        lastSyncTime: new Date().toISOString(),
        autoSync: false
      })

      toast.success('Connected to existing gist')
      return gist
    } catch (error) {
      toast.error('Failed to connect to gist: ' + (error as Error).message)
      throw error
    } finally {
      setIsSyncing(false)
    }
  }, [syncService, setSyncSettings, setGithubToken])

  return {
    syncSettings,
    isSyncing,
    enableSync,
    disableSync,
    pushToGist,
    pullFromGist,
    updateVisibility,
    toggleAutoSync,
    findExistingGists,
    connectToExistingGist
  }
}
