import { useRef, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Download, Upload, GithubLogo, CloudArrowUp, CloudArrowDown, Trash, LockKey, Globe, Info } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { parseEBirdCSV, detectImportConflicts, exportLifeListToCSV } from '@/lib/ebird'
import { useGistSync } from '@/hooks/use-gist-sync'
import { mergeImportedData } from '@/lib/gist-sync'
import type { useBirdDexData } from '@/hooks/use-birddex-data'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface SettingsPageProps {
  data: ReturnType<typeof useBirdDexData>
  user: {
    login: string
    avatarUrl: string
    email: string
  }
}

export default function SettingsPage({ data, user }: SettingsPageProps) {
  const importFileRef = useRef<HTMLInputElement>(null)
  const [showTokenDialog, setShowTokenDialog] = useState(false)
  const [githubToken, setGithubTokenInput] = useState('')
  const [tokenVisibility, setTokenVisibility] = useState<'public' | 'private'>('private')

  const gistSync = useGistSync()

  const handleImportEBird = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const content = await file.text()
      const previews = parseEBirdCSV(content)

      if (previews.length === 0) {
        toast.error('No valid data found in CSV')
        return
      }

      const existingMap = new Map(
        data.lifeList.map(entry => [entry.speciesName, entry])
      )

      const withConflicts = detectImportConflicts(previews, existingMap)

      const entriesToImport = withConflicts
        .filter(p => p.conflict === 'new' || p.conflict === 'update_dates')
        .map(preview => ({
          speciesName: preview.speciesName,
          firstSeenDate: preview.date,
          lastSeenDate: preview.date,
          totalOutings: 1,
          totalCount: preview.count,
          notes: preview.location,
          bestPhotoId: undefined
        }))

      data.importLifeListEntries(entriesToImport)

      toast.success(
        `Imported ${entriesToImport.length} species from eBird`
      )
    } catch (error) {
      toast.error('Failed to import eBird data')
      console.error(error)
    }

    if (importFileRef.current) {
      importFileRef.current.value = ''
    }
  }

  const handleExportLifeList = () => {
    const csv = exportLifeListToCSV(data.lifeList)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `birddex-lifelist-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Life list exported')
  }

  const handleEnableSync = async () => {
    if (!githubToken) {
      toast.error('Please enter a GitHub token')
      return
    }

    try {
      await gistSync.enableSync(tokenVisibility === 'public', githubToken)
      await handlePushToGist()
      setShowTokenDialog(false)
      setGithubTokenInput('')
    } catch (error) {
      console.error('Sync enable failed:', error)
    }
  }

  const handleDisableSync = async (deleteGist: boolean) => {
    try {
      await gistSync.disableSync(deleteGist)
    } catch (error) {
      console.error('Sync disable failed:', error)
    }
  }

  const handlePushToGist = async () => {
    try {
      await gistSync.pushToGist({
        photos: data.photos,
        outings: data.outings,
        observations: data.observations,
        lifeList: data.lifeList,
        savedSpots: data.savedSpots
      })
    } catch (error) {
      console.error('Push failed:', error)
    }
  }

  const handlePullFromGist = async () => {
    try {
      const remoteData = await gistSync.pullFromGist()
      if (!remoteData) return

      const localData = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        photos: data.photos,
        outings: data.outings,
        observations: data.observations,
        lifeList: data.lifeList,
        savedSpots: data.savedSpots
      }

      const merged = mergeImportedData(localData, remoteData)

      data.importLifeListEntries(merged.lifeList)
      toast.success('Data merged from GitHub')
    } catch (error) {
      console.error('Pull failed:', error)
    }
  }

  const handleToggleVisibility = async () => {
    const newVisibility = !gistSync.syncSettings?.isPublic
    try {
      await gistSync.updateVisibility(newVisibility)
    } catch (error) {
      console.error('Toggle visibility failed:', error)
    }
  }

  return (
    <div className="p-4 space-y-6">
      <div className="space-y-2">
        <h2 className="font-serif text-2xl font-semibold text-foreground">
          Settings
        </h2>
        <p className="text-sm text-muted-foreground">
          Signed in as {user.login}
        </p>
      </div>

      <Card className="p-4 space-y-4">
        <div className="space-y-2">
          <h3 className="font-semibold text-foreground">Import & Export</h3>
          <p className="text-sm text-muted-foreground">
            Sync your data with eBird
          </p>
        </div>

        <div className="space-y-3">
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => importFileRef.current?.click()}
          >
            <Upload size={20} className="mr-2" />
            Import from eBird CSV
          </Button>

          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={handleExportLifeList}
            disabled={data.lifeList.length === 0}
          >
            <Download size={20} className="mr-2" />
            Export Life List
          </Button>

          <input
            ref={importFileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleImportEBird}
          />
        </div>
      </Card>

      <Card className="p-4 space-y-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <GithubLogo size={20} weight="fill" />
            <h3 className="font-semibold text-foreground">GitHub Sync</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Backup your Bird-Dex data to a GitHub Gist
          </p>
        </div>

        {!gistSync.syncSettings?.enabled ? (
          <>
            <Alert>
              <AlertDescription className="text-sm space-y-2">
                <p>
                  Store your data in a GitHub Gist (public or private) to backup and sync across devices.
                  You'll need a GitHub Personal Access Token with 'gist' scope.
                </p>
                <a 
                  href="https://github.com/settings/tokens/new?scopes=gist&description=Bird-Dex%20Sync"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline text-xs"
                >
                  <Info size={14} />
                  Create a token on GitHub
                </a>
              </AlertDescription>
            </Alert>
            <Button
              className="w-full"
              onClick={() => setShowTokenDialog(true)}
            >
              <GithubLogo size={20} className="mr-2" weight="fill" />
              Enable GitHub Sync
            </Button>
          </>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-muted rounded-md">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {gistSync.syncSettings.isPublic ? (
                    <Globe size={16} className="text-muted-foreground" />
                  ) : (
                    <LockKey size={16} className="text-muted-foreground" />
                  )}
                  <span className="text-sm font-medium">
                    {gistSync.syncSettings.isPublic ? 'Public' : 'Private'} Gist
                  </span>
                </div>
                {gistSync.syncSettings.lastSyncTime && (
                  <p className="text-xs text-muted-foreground">
                    Last synced: {new Date(gistSync.syncSettings.lastSyncTime).toLocaleString()}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleToggleVisibility}
                disabled={gistSync.isSyncing}
              >
                Make {gistSync.syncSettings.isPublic ? 'Private' : 'Public'}
              </Button>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label htmlFor="auto-sync" className="text-sm font-medium">
                  Auto-sync on changes
                </Label>
                <p className="text-xs text-muted-foreground">
                  Automatically backup after each outing
                </p>
              </div>
              <Switch
                id="auto-sync"
                checked={gistSync.syncSettings.autoSync}
                onCheckedChange={gistSync.toggleAutoSync}
              />
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                onClick={handlePushToGist}
                disabled={gistSync.isSyncing}
              >
                <CloudArrowUp size={20} className="mr-2" />
                Push
              </Button>
              <Button
                variant="outline"
                onClick={handlePullFromGist}
                disabled={gistSync.isSyncing}
              >
                <CloudArrowDown size={20} className="mr-2" />
                Pull
              </Button>
            </div>

            <Separator />

            <div className="space-y-2">
              <Button
                variant="outline"
                className="w-full text-destructive border-destructive/50 hover:bg-destructive/10"
                onClick={() => handleDisableSync(false)}
                disabled={gistSync.isSyncing}
              >
                Disable Sync (Keep Gist)
              </Button>
              <Button
                variant="destructive"
                className="w-full"
                onClick={() => handleDisableSync(true)}
                disabled={gistSync.isSyncing}
              >
                <Trash size={20} className="mr-2" />
                Disable & Delete Gist
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Dialog open={showTokenDialog} onOpenChange={setShowTokenDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enable GitHub Sync</DialogTitle>
            <DialogDescription className="space-y-2">
              <p>Create a Personal Access Token with 'gist' scope.</p>
              <a 
                href="https://github.com/settings/tokens/new?scopes=gist&description=Bird-Dex%20Sync"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline text-sm"
              >
                <GithubLogo size={16} />
                Create token on GitHub →
              </a>
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="token">GitHub Personal Access Token</Label>
              <Input
                id="token"
                type="password"
                placeholder="ghp_..."
                value={githubToken}
                onChange={(e) => setGithubTokenInput(e.target.value)}
              />
            </div>

            <div className="space-y-3">
              <Label>Gist Visibility</Label>
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant={tokenVisibility === 'private' ? 'default' : 'outline'}
                  className="flex-1"
                  onClick={() => setTokenVisibility('private')}
                >
                  <LockKey size={20} className="mr-2" />
                  Private
                </Button>
                <Button
                  type="button"
                  variant={tokenVisibility === 'public' ? 'default' : 'outline'}
                  className="flex-1"
                  onClick={() => setTokenVisibility('public')}
                >
                  <Globe size={20} className="mr-2" />
                  Public
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {tokenVisibility === 'private' 
                  ? 'Only you can see this gist'
                  : 'Anyone with the link can view this gist'}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTokenDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleEnableSync} disabled={!githubToken || gistSync.isSyncing}>
              Enable Sync
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="p-4 space-y-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Info size={20} />
            <h3 className="font-semibold text-foreground">Vision API Test</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Test if the AI bird identification is working properly
          </p>
        </div>
        
        <div className="space-y-3">
          <Button
            variant="outline"
            className="w-full"
            onClick={async () => {
              try {
                toast.info('Testing Vision API access...')
                const testPrompt = (window.spark.llmPrompt as any)`Test message: respond with "API is working" if you receive this.`
                const response = await window.spark.llm(testPrompt, 'gpt-4o', false)
                toast.success('Vision API is accessible!')
                console.log('API Test Response:', response)
              } catch (error) {
                toast.error(`Vision API error: ${error instanceof Error ? error.message : 'Unknown error'}`)
                console.error('API Test Error:', error)
              }
            }}
          >
            Test Vision API Connection
          </Button>
          
          <Alert>
            <AlertDescription className="text-xs">
              If the test fails, bird identification will not work. Check browser console for detailed errors.
            </AlertDescription>
          </Alert>
        </div>
      </Card>

      <Card className="p-4 space-y-2">
        <h3 className="font-semibold text-foreground">About Bird-Dex</h3>
        <p className="text-sm text-muted-foreground">
          Bird-Dex helps you track bird sightings and maintain a life list.
          Compatible with eBird for import/export.
        </p>
        <p className="text-xs text-muted-foreground">
          Version 1.0.0
        </p>
      </Card>

      <Card className="p-4 space-y-2">
        <h3 className="font-semibold text-foreground">Data Storage</h3>
        <p className="text-sm text-muted-foreground">
          By default, your data is stored locally on this device. Enable GitHub Sync to backup
          your data to the cloud and access it from multiple devices.
        </p>
        <div className="text-xs text-muted-foreground space-y-1 pt-2">
          <p>• <strong>Local storage:</strong> Fast, always available, device-specific</p>
          <p>• <strong>GitHub Gist:</strong> Cloud backup, multi-device sync, portable</p>
        </div>
      </Card>
    </div>
  )
}
