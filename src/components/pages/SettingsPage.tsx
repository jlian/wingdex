import { useRef, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Download, Upload, Info, MapPin, Plus, Trash, X, Check, Database, Warning, ShieldCheck } from '@phosphor-icons/react'
import { textLLM } from '@/lib/ai-inference'
import { toast } from 'sonner'
import { parseEBirdCSV, detectImportConflicts, exportLifeListToCSV } from '@/lib/ebird'
import { SEED_OUTINGS, SEED_OBSERVATIONS, SEED_LIFE_LIST } from '@/lib/seed-data'
import type { useBirdDexData } from '@/hooks/use-birddex-data'
import type { SavedSpot } from '@/lib/types'

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

  return (
    <div className="px-4 sm:px-6 py-6 space-y-6 max-w-3xl mx-auto">
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

      <SavedLocationsSection data={data} />

      {/* Data Storage & Privacy */}
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <ShieldCheck size={18} className="text-primary" />
          Data Storage &amp; Privacy
        </h3>
        <div className="text-sm text-muted-foreground space-y-2">
          <p>
            <strong>Your photos are never stored.</strong> Photos are processed
            locally for AI identification and then discarded. They never leave
            your device or get uploaded to any server.
          </p>
          <p>
            Your birding records (outings, species, sightings) are stored on
            GitHub&apos;s infrastructure, scoped entirely to your GitHub
            account. <strong>We don&apos;t operate any servers or databases</strong> —
            all data lives in GitHub&apos;s key-value store tied to your login.
          </p>
          <p>
            Species images in the life list are loaded on-demand from Wikimedia
            Commons and Wikipedia. No images are cached or stored.
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
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => {
              data.loadSeedData(SEED_OUTINGS, SEED_OBSERVATIONS, SEED_LIFE_LIST)
              toast.success('Demo data loaded: 5 outings, 17 species')
            }}
          >
            <Database size={20} className="mr-2" />
            Load Demo Data
          </Button>

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
                  life list entries, and saved locations. This action cannot be
                  undone.
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
              If the test fails, bird identification will not work. Check browser console for detailed errors.
            </AlertDescription>
          </Alert>
        </div>
      </Card>

      <Card className="p-4 space-y-2">
        <h3 className="font-semibold text-foreground">About BirdDex</h3>
        <p className="text-sm text-muted-foreground">
          Photo-first bird identification for reverse birders.
          Upload photos, let AI identify the species, build your life list.
        </p>
        <p className="text-xs text-muted-foreground">
          Version 1.0.0
        </p>
      </Card>
    </div>
  )
}

// ─── Saved Locations ──────────────────────────────────────

function SavedLocationsSection({ data }: { data: ReturnType<typeof useBirdDexData> }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [lat, setLat] = useState('')
  const [lon, setLon] = useState('')
  const [gettingLocation, setGettingLocation] = useState(false)

  const handleAdd = () => {
    const parsedLat = parseFloat(lat)
    const parsedLon = parseFloat(lon)
    if (!name.trim() || isNaN(parsedLat) || isNaN(parsedLon)) {
      toast.error('Please fill in all fields with valid values')
      return
    }
    const spot: SavedSpot = {
      id: `spot_${Date.now()}`,
      name: name.trim(),
      lat: parsedLat,
      lon: parsedLon,
      createdAt: new Date().toISOString(),
    }
    data.addSavedSpot(spot)
    setName('')
    setLat('')
    setLon('')
    setAdding(false)
    toast.success(`Saved "${spot.name}"`)
  }

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation not supported')
      return
    }
    setGettingLocation(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6))
        setLon(pos.coords.longitude.toFixed(6))
        setGettingLocation(false)
        toast.success('Location detected')
      },
      (err) => {
        toast.error(`Location error: ${err.message}`)
        setGettingLocation(false)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  // Count outings near each saved spot (within ~500m)
  const getOutingsNearSpot = (spot: SavedSpot) => {
    return data.outings.filter(o => {
      if (!o.lat || !o.lon) return false
      const dlat = Math.abs(o.lat - spot.lat)
      const dlon = Math.abs(o.lon - spot.lon)
      return dlat < 0.005 && dlon < 0.005 // ~500m
    })
  }

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <MapPin size={18} weight="fill" className="text-primary" />
            Saved Locations
          </h3>
          <p className="text-sm text-muted-foreground">
            Your favorite birding spots
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAdding(!adding)}
        >
          {adding ? <X size={14} className="mr-1" /> : <Plus size={14} className="mr-1" />}
          {adding ? 'Cancel' : 'Add'}
        </Button>
      </div>

      {adding && (
        <div className="space-y-3 p-3 rounded-md border border-primary/30 bg-muted/30">
          <div className="space-y-1">
            <Label htmlFor="spot-name">Name</Label>
            <Input
              id="spot-name"
              placeholder="e.g. Riverside Park"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="spot-lat">Latitude</Label>
              <Input
                id="spot-lat"
                type="number"
                step="any"
                placeholder="43.6532"
                value={lat}
                onChange={e => setLat(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="spot-lon">Longitude</Label>
              <Input
                id="spot-lon"
                type="number"
                step="any"
                placeholder="-79.3832"
                value={lon}
                onChange={e => setLon(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleUseCurrentLocation}
              disabled={gettingLocation}
            >
              <MapPin size={14} className="mr-1" />
              {gettingLocation ? 'Detecting...' : 'Use Current Location'}
            </Button>
            <Button size="sm" onClick={handleAdd} disabled={!name.trim()}>
              <Check size={14} className="mr-1" />
              Save
            </Button>
          </div>
        </div>
      )}

      {data.savedSpots.length === 0 && !adding ? (
        <div className="text-center py-6 space-y-2">
          <div className="flex justify-center">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <MapPin size={24} className="text-primary" weight="duotone" />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">No saved locations yet</p>
          <p className="text-xs text-muted-foreground">
            Save your favorite birding spots for quick access when creating outings
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {data.savedSpots.map(spot => {
            const nearbyOutings = getOutingsNearSpot(spot)
            const mapsUrl = `https://www.google.com/maps?q=${spot.lat},${spot.lon}`

            return (
              <div
                key={spot.id}
                className="flex items-center gap-3 py-2.5"
              >
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <MapPin size={16} className="text-primary" weight="fill" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{spot.name}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-foreground transition-colors"
                    >
                      {spot.lat.toFixed(4)}, {spot.lon.toFixed(4)}
                    </a>
                    {nearbyOutings.length > 0 && (
                      <>
                        <span>·</span>
                        <span>{nearbyOutings.length} {nearbyOutings.length === 1 ? 'outing' : 'outings'}</span>
                      </>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive flex-shrink-0 h-8 w-8 p-0"
                  onClick={() => {
                    data.deleteSavedSpot(spot.id)
                    toast.success(`Removed "${spot.name}"`)
                  }}
                >
                  <Trash size={14} />
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
