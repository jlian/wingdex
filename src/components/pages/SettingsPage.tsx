import { useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Confetti } from '@/components/ui/confetti'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Download, Upload, Info, Database, ShieldCheck, CaretDown, Sun, Moon, Desktop, Trash, GlobeHemisphereWest, Key, SignOut, Envelope } from '@phosphor-icons/react'
import { authClient } from '@/lib/auth-client'
import { fetchWithLocalAuthRetry, isLocalRuntime } from '@/lib/local-auth-fetch'
import { toast } from 'sonner'
import demoCsv from '../../../e2e/fixtures/ebird-import.csv?raw'
import type { WingDexDataStore } from '@/hooks/use-wingdex-data'

function errCode(err: { code?: string; message?: string }): string | undefined {
  return 'code' in err ? err.code : undefined
}

interface SettingsPageProps {
  data: WingDexDataStore
  user: {
    id: string
    name: string
    image: string
    email: string
    isAnonymous: boolean
  }
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

  // Passkey management
  const [passkeys, setPasskeys] = useState<Array<{ id: string; name?: string; createdAt: Date }>>([]) 
  const [passkeysLoading, setPasskeysLoading] = useState(false)
  const passkeysLoaded = useRef(false)

  const hasPlaceholderEmail = !user.email || user.email.endsWith('@localhost')
  const [newEmail, setNewEmail] = useState('')
  const [emailSaving, setEmailSaving] = useState(false)

  useEffect(() => {
    if (user.isAnonymous || passkeysLoaded.current) return
    passkeysLoaded.current = true
    setPasskeysLoading(true)
    void authClient.passkey.listUserPasskeys().then((result) => {
      if (result.data) {
        setPasskeys(result.data.map((p) => ({
          id: p.id, name: p.name, createdAt: new Date(p.createdAt),
        })))
      }
      setPasskeysLoading(false)
    }).catch(() => setPasskeysLoading(false))
  }, [user.isAnonymous])

  useEffect(() => {
    setMounted(true)
  }, [])

  const handleImportEBird = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const makePreviewFormData = () => {
        const formData = new FormData()
        formData.append('file', file)
        if (profileTimezone !== 'observation-local') {
          formData.append('profileTimezone', profileTimezone)
        }
        return formData
      }

      const postPreview = () => fetch('/api/import/ebird-csv', {
        method: 'POST',
        credentials: 'include',
        body: makePreviewFormData(),
      })

      let previewResponse = await postPreview()
      if (previewResponse.status === 401 && isLocalRuntime()) {
        const signInResult = await authClient.signIn.anonymous()
        if (!signInResult.error) {
          previewResponse = await postPreview()
        }
      }

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

      await data.refresh()
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
        {!user.isAnonymous && (
          <p className="text-sm text-muted-foreground">
            Signed in as {user.name}
          </p>
        )}
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

      {!user.isAnonymous && (
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
                  <select
                    value={profileTimezone}
                    onChange={e => setProfileTimezone(e.target.value)}
                    className="w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 bg-[length:16px_16px] bg-[position:right_8px_center] bg-no-repeat"
                    style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m7 15 5 5 5-5'/%3E%3Cpath d='m7 9 5-5 5 5'/%3E%3C/svg%3E")` }}
                  >
                    <option value="America/Los_Angeles">Pacific (PST/PDT)</option>
                    <option value="America/Denver">Mountain (MST/MDT)</option>
                    <option value="America/Chicago">Central (CST/CDT)</option>
                    <option value="America/New_York">Eastern (EST/EDT)</option>
                    <option value="Pacific/Honolulu">Hawaii (HST)</option>
                    <option value="America/Anchorage">Alaska (AKST/AKDT)</option>
                    <option value="America/Puerto_Rico">Atlantic (AST)</option>
                    <option value="Europe/London">London (GMT/BST)</option>
                    <option value="Europe/Paris">Central Europe (CET/CEST)</option>
                    <option value="Asia/Kolkata">India (IST)</option>
                    <option value="Asia/Shanghai">China (CST)</option>
                    <option value="Asia/Taipei">Taipei (CST)</option>
                    <option value="Asia/Tokyo">Japan (JST)</option>
                    <option value="Australia/Sydney">Sydney (AEST/AEDT)</option>
                    <option value="Pacific/Auckland">New Zealand (NZST/NZDT)</option>
                    <option value="observation-local">None (times already local)</option>
                  </select>
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
      )}

      {!user.isAnonymous && (
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold text-foreground">Account</h3>

        {/* Email — show form if user has placeholder email */}
        {hasPlaceholderEmail && (
          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Envelope size={14} />
              Add email for account recovery
            </label>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="you@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                disabled={emailSaving}
                className="flex-1"
              />
              <Button
                variant="outline"
                disabled={emailSaving || !newEmail.trim()}
                onClick={async () => {
                  setEmailSaving(true)
                  const res = await fetch('/api/auth/finalize-passkey', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: user.name, email: newEmail.trim().toLowerCase() }),
                  })
                  setEmailSaving(false)
                  if (!res.ok) {
                    const data = await res.json().catch(() => null) as { error?: string } | null
                    toast.error(data?.error === 'email_taken' ? 'Email already in use' : 'Failed to save email')
                    return
                  }
                  toast.success('Email saved')
                  setNewEmail('')
                  // Session will refresh on next auth check
                }}
              >
                {emailSaving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        )}

        {/* Passkey list */}
        <div className="space-y-2">
            {passkeysLoading ? (
              <p className="text-sm text-muted-foreground">Loading passkeys…</p>
            ) : passkeys.length > 0 ? (
              passkeys.map((pk) => (
                <div key={pk.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Key size={16} className="shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{pk.name || 'Passkey'}</p>
                      <p className="text-xs text-muted-foreground">
                        Added {pk.createdAt.toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  {passkeys.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0 ml-2"
                      onClick={async () => {
                        const result = await authClient.passkey.deletePasskey({ id: pk.id })
                        if (result.error) {
                          toast.error(result.error.message || 'Failed to remove passkey')
                          return
                        }
                        setPasskeys((prev) => prev.filter((p) => p.id !== pk.id))
                        toast.success('Passkey removed')
                      }}
                    >
                      <Trash size={16} />
                    </Button>
                  )}
                </div>
              ))
            ) : null}
          </div>

        <div className="space-y-2">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={async () => {
                const label = user.email && !user.email.endsWith('@localhost')
                  ? user.email
                  : user.name
                const result = await authClient.passkey.addPasskey({
                  name: label,
                  authenticatorAttachment: 'platform',
                })
                if (result.error) {
                  if (errCode(result.error) === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
                    toast.error('This device already has a passkey registered.')
                  } else if (errCode(result.error) !== 'ERROR_CEREMONY_ABORTED') {
                    toast.error(result.error.message || 'Failed to add passkey')
                  }
                  return
                }
                // Refresh the list
                const listResult = await authClient.passkey.listUserPasskeys()
                if (listResult.data) {
                  setPasskeys(listResult.data.map((p) => ({
                    id: p.id, name: p.name, createdAt: new Date(p.createdAt),
                  })))
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
              const signOutResult = await authClient.signOut()
              if (signOutResult.error) {
                toast.error(signOutResult.error.message || 'Failed to sign out')
                return
              }

              if (isLocalRuntime()) {
                const localSignInResult = await authClient.signIn.anonymous()
                if (localSignInResult.error) {
                  toast.error(localSignInResult.error.message || 'Signed out, but failed to restore local session')
                } else {
                  await data.refresh()
                }
              }

              toast.success('Signed out')
            }}
          >
            <SignOut size={20} className="mr-2" />
            Sign out
          </Button>
        </div>
      </Card>
      )}

      {/* Data Storage & Privacy */}
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <ShieldCheck size={18} className="text-primary" />
          Data Storage &amp; Privacy
        </h3>
        <div className="text-sm text-muted-foreground space-y-2">
          <p>
            <strong>Your photos are never stored.</strong> During identification,
            compressed images are sent to WingDex&apos;s server-side AI endpoint for processing, then
            immediately discarded.
          </p>
          <p>
            Your birding records (outings, species, and sightings) are saved
            to WingDex&apos;s Cloudflare-backed database, scoped to your account.
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
                  onClick={async () => {
                    try {
                      data.clearAllData()

                      const formData = new FormData()
                      formData.append('file', new Blob([demoCsv], { type: 'text/csv' }), 'demo.csv')

                      const previewRes = await fetchWithLocalAuthRetry('/api/import/ebird-csv', {
                        method: 'POST',
                        credentials: 'include',
                        body: formData,
                      })
                      if (!previewRes.ok) throw new Error(`Preview failed (${previewRes.status})`)

                      const { previews } = await previewRes.json() as {
                        previews: Array<{ previewId: string }>
                      }

                      const confirmRes = await fetchWithLocalAuthRetry('/api/import/ebird-csv/confirm', {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ previewIds: previews.map(p => p.previewId) }),
                      })
                      if (!confirmRes.ok) throw new Error(`Confirm failed (${confirmRes.status})`)

                      const { imported } = await confirmRes.json() as {
                        imported: { outings: number; newSpecies: number }
                      }

                      await data.refresh()
                      toast.success(`Demo data loaded: ${imported.outings} outings, ${imported.newSpecies} species`)
                    } catch (error) {
                      const detail = error instanceof Error ? error.message : 'Unknown error'
                      toast.error(`Failed to load demo data: ${detail}`)
                    }
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

    </div>
    </>
  )
}
