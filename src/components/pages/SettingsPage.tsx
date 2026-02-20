import { useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Confetti } from '@/components/ui/confetti'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Download, Upload, Info, Database, ShieldCheck, CaretDown, Sun, Moon, Desktop, Trash, GlobeHemisphereWest, Key, SignOut } from '@phosphor-icons/react'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { textLLM } from '@/lib/ai-inference'
import { authClient } from '@/lib/auth-client'
import { toast } from 'sonner'
import { SEED_OUTINGS, SEED_OBSERVATIONS, SEED_DEX } from '@/lib/seed-data'
import type { WingDexDataStore } from '@/hooks/use-wingdex-data'

interface SettingsPageProps {
  data: WingDexDataStore
  user: {
    id: string
    name: string
    image: string
    email: string
  }
}

function isLocalRuntime(): boolean {
  const host = window.location.hostname.toLowerCase()
  return host === 'localhost' || host === '127.0.0.1'
}

async function fetchWithLocalAuthRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const firstResponse = await fetch(input, init)
  if (firstResponse.status !== 401 || !isLocalRuntime()) {
    return firstResponse
  }

  const signInResult = await authClient.signIn.anonymous()
  if (signInResult.error) {
    return firstResponse
  }

  return fetch(input, init)
}

export default function SettingsPage({ data, user }: SettingsPageProps) {
  const importFileRef = useRef<HTMLInputElement>(null)
  const [showEBirdHelp, setShowEBirdHelp] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [showConfetti, setShowConfetti] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [profileTimezone, setProfileTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles'
  )
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    setMounted(true)
  }, [])

  const handleImportEBird = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const formData = new FormData()
      formData.append('file', file)
      if (profileTimezone !== 'observation-local') {
        formData.append('profileTimezone', profileTimezone)
      }

      const previewResponse = await fetchWithLocalAuthRetry('/api/import/ebird-csv', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })

      if (!previewResponse.ok) {
        throw new Error(`Preview failed (${previewResponse.status})`)
      }

      const previewPayload = await previewResponse.json() as {
        previews: Array<{ previewId: string; speciesName: string; conflict?: 'new' | 'duplicate' | 'update_dates' }>
      }

      const selectedPreviewIds = previewPayload.previews
        .filter(preview => preview.conflict !== 'duplicate')
        .map(preview => preview.previewId)

      if (selectedPreviewIds.length === 0) {
        toast.error('No valid data found in CSV')
        return
      }

      const confirmResponse = await fetchWithLocalAuthRetry('/api/import/ebird-csv/confirm', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ previewIds: selectedPreviewIds }),
      })

      if (!confirmResponse.ok) {
        throw new Error(`Confirm failed (${confirmResponse.status})`)
      }

      const confirmPayload = await confirmResponse.json() as {
        imported: { outings: number; newSpecies: number }
      }

      if (confirmPayload.imported.newSpecies > 0) {
        setShowConfetti(true)
        setTimeout(() => setShowConfetti(false), 3500)
      }

      toast.success(
        `Imported eBird data across ${confirmPayload.imported.outings} outings` +
        (confirmPayload.imported.newSpecies > 0 ? ` (${confirmPayload.imported.newSpecies} new!)` : '')
      )

      window.location.reload()
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown error'
      toast.error(`Failed to import eBird data: ${detail}`)
      console.error(error)
    }

    if (importFileRef.current) {
      importFileRef.current.value = ''
    }
  }

  const handleExportDex = async () => {
    try {
      const response = await fetchWithLocalAuthRetry('/api/export/dex', { credentials: 'include' })
      if (!response.ok) {
        throw new Error(`Export failed (${response.status})`)
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `wingdex-export-${new Date().toISOString().split('T')[0]}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('WingDex exported')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown error'
      toast.error(`Failed to export WingDex: ${detail}`)
    }
  }

  return (
    <>
    <Confetti active={showConfetti} />
    <div className="px-4 sm:px-6 py-6 space-y-6 max-w-3xl mx-auto animate-fade-in">
      <div className="space-y-2">
        <h2 className="font-serif text-2xl font-semibold text-foreground">
          Settings
        </h2>
        <p className="text-sm text-muted-foreground">
          Signed in as {user.name}
        </p>
      </div>

      {/* Appearance */}
      <Card className="p-4 space-y-4">
        <div className="space-y-2">
          <h3 className="font-semibold text-foreground">Appearance</h3>
          <p className="text-sm text-muted-foreground">
            Choose your preferred color scheme
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {([
            { value: 'light', label: 'Light', icon: Sun },
            { value: 'dark', label: 'Dark', icon: Moon },
            { value: 'system', label: 'System', icon: Desktop },
          ] as const).map(({ value, label, icon: Icon }) => (
            <Button
              key={value}
              variant={mounted && theme === value ? 'default' : 'outline'}
              className="flex flex-col items-center gap-1.5 h-auto py-3"
              onClick={() => setTheme(value)}
            >
              <Icon size={20} />
              <span className="text-xs">{label}</span>
            </Button>
          ))}
        </div>
      </Card>

      <Card className="p-4 space-y-4">
        <div className="space-y-2">
          <h3 className="font-semibold text-foreground">Import & Export</h3>
          <p className="text-sm text-muted-foreground">
            Import your eBird life list or export your WingDex data
          </p>
        </div>

        <div className="space-y-3">
          <AlertDialog open={showImportDialog} onOpenChange={setShowImportDialog}>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                className="w-full justify-start"
              >
                <Upload size={20} className="mr-2" />
                Import from eBird CSV
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Import from eBird CSV</AlertDialogTitle>
                <AlertDialogDescription>
                  Choose your eBird profile timezone before selecting your CSV file.
                </AlertDialogDescription>
              </AlertDialogHeader>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <GlobeHemisphereWest size={14} />
                    eBird profile timezone
                  </label>
                  <Select value={profileTimezone} onValueChange={setProfileTimezone}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="America/Los_Angeles">Pacific (PST/PDT)</SelectItem>
                      <SelectItem value="America/Denver">Mountain (MST/MDT)</SelectItem>
                      <SelectItem value="America/Chicago">Central (CST/CDT)</SelectItem>
                      <SelectItem value="America/New_York">Eastern (EST/EDT)</SelectItem>
                      <SelectItem value="Pacific/Honolulu">Hawaii (HST)</SelectItem>
                      <SelectItem value="America/Anchorage">Alaska (AKST/AKDT)</SelectItem>
                      <SelectItem value="America/Puerto_Rico">Atlantic (AST)</SelectItem>
                      <SelectItem value="Europe/London">London (GMT/BST)</SelectItem>
                      <SelectItem value="Europe/Paris">Central Europe (CET/CEST)</SelectItem>
                      <SelectItem value="Asia/Kolkata">India (IST)</SelectItem>
                      <SelectItem value="Asia/Shanghai">China (CST)</SelectItem>
                      <SelectItem value="Asia/Taipei">Taipei (CST)</SelectItem>
                      <SelectItem value="Asia/Tokyo">Japan (JST)</SelectItem>
                      <SelectItem value="Australia/Sydney">Sydney (AEST/AEDT)</SelectItem>
                      <SelectItem value="Pacific/Auckland">New Zealand (NZST/NZDT)</SelectItem>
                      <SelectItem value="observation-local">None (times already local)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <p className="text-xs text-muted-foreground">
                  eBird records times in the timezone of the device that submitted
                  the checklist &mdash; typically your phone&apos;s home timezone.
                  This includes Merlin: if you ID photos from a trip abroad at
                  home, Merlin maps the photo&apos;s time to your device&apos;s
                  timezone. If you only bird locally, choose &ldquo;None&rdquo;.
                  Otherwise, select your home timezone so we can convert times to
                  each observation&apos;s local time.
                </p>
              </div>

              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    setShowImportDialog(false)
                    importFileRef.current?.click()
                  }}
                >
                  Choose CSV File
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={handleExportDex}
            disabled={data.dex.length === 0}
          >
            <Download size={20} className="mr-2" />
            Export WingDex
          </Button>

          <input
            ref={importFileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleImportEBird}
          />

          <button
            onClick={() => setShowEBirdHelp(!showEBirdHelp)}
            className="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors cursor-pointer w-full"
          >
            <Info size={16} />
            <span>How to export from eBird</span>
            <CaretDown
              size={14}
              className={`transition-transform ${showEBirdHelp ? 'rotate-180' : ''}`}
            />
          </button>

          {showEBirdHelp && (
            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3 text-sm text-muted-foreground animate-fade-in">
              <p className="font-medium text-foreground">
                Export your eBird data in 3 steps:
              </p>
              <ol className="list-decimal list-inside space-y-2">
                <li>
                  Go to{' '}
                  <a
                    href="https://ebird.org/downloadMyData"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline underline-offset-2"
                  >
                    ebird.org/downloadMyData
                  </a>{' '}
                  and sign in
                </li>
                <li>
                  Click <strong className="text-foreground">Submit</strong> to
                  request your data download
                </li>
                <li>
                  You will receive an email with a download link for your CSV file.
                  Upload that file here.
                </li>
              </ol>
              <p className="text-xs">
                WingDex will create outings grouped by date and location, with all your
                species as confirmed observations.
              </p>
            </div>
          )}
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <h3 className="font-semibold text-foreground">Account</h3>
        <div className="space-y-2">
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={async () => {
              const result = await authClient.passkey.addPasskey({
                name: 'WingDex passkey',
                authenticatorAttachment: 'platform',
              })
              if (result.error) {
                toast.error(result.error.message || 'Failed to add passkey')
                return
              }
              toast.success('Passkey added')
            }}
          >
            <Key size={20} className="mr-2" />
            Add another passkey
          </Button>

          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={async () => {
              await authClient.signOut()
              window.location.reload()
            }}
          >
            <SignOut size={20} className="mr-2" />
            Sign out
          </Button>
        </div>
      </Card>

      {/* Data Storage & Privacy */}
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <ShieldCheck size={18} className="text-primary" />
          Data Storage &amp; Privacy
        </h3>
        <div className="text-sm text-muted-foreground space-y-2">
          <p>
            <strong>Your photos are never stored.</strong> During identification,
            compressed images are sent to GitHub Models for AI processing, then
            immediately discarded.
          </p>
          <p>
            Your birding records (outings, species, and sightings) are saved
            to GitHub&apos;s key-value store, scoped to your GitHub account.
            There is no separate backend; all data stays within GitHub&apos;s
            infrastructure.
          </p>
          <p>
            Location lookups use OpenStreetMap Nominatim to resolve GPS
            coordinates into place names. Species images are loaded on-demand
            from Wikimedia Commons.
          </p>
        </div>
      </Card>

      {/* Data Management */}
      <Card className="p-4 space-y-4">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <Database size={18} />
          Data Management
        </h3>
        <div className="space-y-3">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                className="w-full justify-start"
              >
                <Database size={20} className="mr-2" />
                Load Demo Data
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Load demo data?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will replace all your current outings, observations,
                  and WingDex entries with demo data. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    data.loadSeedData(SEED_OUTINGS, SEED_OBSERVATIONS, SEED_DEX)
                    toast.success(`Demo data loaded: ${SEED_OUTINGS.length} outings, ${SEED_DEX.length} species`)
                  }}
                >
                  Load Demo Data
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                className="w-full justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash size={20} className="mr-2" />
                Delete All Data
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete all data?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete all your outings, observations,
                  and WingDex entries. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => {
                    data.clearAllData()
                    toast.success('All data deleted')
                  }}
                >
                  Delete Everything
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </Card>

      {/* Vision API Test — developer/debug tool */}
      <Card className="p-4 space-y-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Info size={20} />
            <h3 className="font-semibold text-foreground">Vision API Test</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Verify that AI-powered bird identification is available
          </p>
        </div>
        
        <div className="space-y-3">
          <Button
            variant="outline"
            className="w-full"
            onClick={async () => {
              try {
                toast.info('Testing Vision API access...')
                const response = await textLLM('Test message: respond with "API is working" if you receive this.')
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
              If the test fails, photo identification won&apos;t work. Check the browser console for details.
            </AlertDescription>
          </Alert>
        </div>
      </Card>


    </div>
    </>
  )
}
