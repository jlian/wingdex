import { useRef } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Download, Upload, Info } from '@phosphor-icons/react'
import { textLLM } from '@/lib/ai-inference'
import { toast } from 'sonner'
import { parseEBirdCSV, detectImportConflicts, exportLifeListToCSV } from '@/lib/ebird'
import type { useBirdDexData } from '@/hooks/use-birddex-data'

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
          BirdDex helps you track bird sightings and maintain a life list.
          Compatible with eBird for import/export.
        </p>
        <p className="text-xs text-muted-foreground">
          Version 1.0.0
        </p>
      </Card>

      <Card className="p-4 space-y-2">
        <h3 className="font-semibold text-foreground">Data Storage</h3>
        <p className="text-sm text-muted-foreground">
          Your data is stored securely in the cloud, tied to your GitHub account.
          It's private to you and accessible from any device where you're signed in.
        </p>
      </Card>
    </div>
  )
}
