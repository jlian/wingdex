import { useState, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { X, CloudArrowUp } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { extractEXIF, generateThumbnail, computeFileHash } from '@/lib/photo-utils'
import { clusterPhotosIntoOutings } from '@/lib/clustering'
import { identifyBirdInPhoto, aggregateSpeciesSuggestions } from '@/lib/ai-inference'
import OutingReview from '@/components/flows/OutingReview'
import SpeciesConfirmation from '@/components/flows/SpeciesConfirmation'
import type { useBirdDexData } from '@/hooks/use-birddex-data'
import type { Photo, SpeciesSuggestion } from '@/lib/types'

interface AddPhotosFlowProps {
  data: ReturnType<typeof useBirdDexData>
  onClose: () => void
  userId: number
}

type FlowStep = 'upload' | 'processing' | 'review' | 'species' | 'complete'

export default function AddPhotosFlow({ data, onClose, userId }: AddPhotosFlowProps) {
  const [step, setStep] = useState<FlowStep>('upload')
  const [photos, setPhotos] = useState<Photo[]>([])
  const [currentClusterIndex, setCurrentClusterIndex] = useState(0)
  const [suggestions, setSuggestions] = useState<SpeciesSuggestion[]>([])
  const [progress, setProgress] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const clusters = photos.length > 0 ? clusterPhotosIntoOutings(photos) : []

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    setStep('processing')
    setProgress(0)

    const processedPhotos: Photo[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      
      try {
        const exif = await extractEXIF(file)
        const thumbnail = await generateThumbnail(file)
        const hash = await computeFileHash(file)

        const existing = data.photos.find(
          p => p.fileHash === hash && p.exifTime === exif.timestamp
        )

        if (existing) {
          toast.error(`${file.name} already imported`)
          continue
        }

        const reader = new FileReader()
        const dataUrl = await new Promise<string>((resolve) => {
          reader.onload = () => resolve(reader.result as string)
          reader.readAsDataURL(file)
        })

        const photo: Photo = {
          id: `photo_${Date.now()}_${i}`,
          outingId: '',
          dataUrl,
          thumbnail,
          exifTime: exif.timestamp,
          gps: exif.gps,
          fileHash: hash,
          fileName: file.name
        }

        processedPhotos.push(photo)
      } catch (error) {
        console.error(`Failed to process ${file.name}:`, error)
        toast.error(`Failed to process ${file.name}`)
      }

      setProgress(((i + 1) / files.length) * 100)
    }

    if (processedPhotos.length === 0) {
      toast.error('No photos to process')
      onClose()
      return
    }

    setPhotos(processedPhotos)
    setStep('review')
  }

  const handleOutingConfirmed = async (
    outingId: string,
    locationName: string,
    lat?: number,
    lon?: number
  ) => {
    const cluster = clusters[currentClusterIndex]
    
    const updatedPhotos = cluster.photos.map(p => ({
      ...p,
      outingId
    }))

    data.addPhotos(updatedPhotos)

    setStep('processing')
    setProgress(0)

    const photoResults = new Map<string, any[]>()

    for (let i = 0; i < cluster.photos.length; i++) {
      const photo = cluster.photos[i]
      
      try {
        const results = await identifyBirdInPhoto(
          photo.dataUrl,
          photo.gps,
          photo.exifTime ? new Date(photo.exifTime).getMonth() : undefined
        )
        
        photoResults.set(photo.id, results)
      } catch (error) {
        console.error('Inference failed for photo:', error)
      }

      setProgress(((i + 1) / cluster.photos.length) * 100)
    }

    const aggregated = aggregateSpeciesSuggestions(photoResults)
    setSuggestions(aggregated)
    setStep('species')
  }

  const handleSpeciesConfirmed = (outingId: string) => {
    if (currentClusterIndex < clusters.length - 1) {
      setCurrentClusterIndex(currentClusterIndex + 1)
      setStep('review')
      setSuggestions([])
    } else {
      toast.success('All outings saved!')
      onClose()
    }
  }

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">
            {step === 'upload' && 'Add Photos'}
            {step === 'processing' && 'Processing...'}
            {step === 'review' && `Review Outing ${currentClusterIndex + 1} of ${clusters.length}`}
            {step === 'species' && 'Confirm Species'}
          </DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-4 top-4"
            onClick={onClose}
          >
            <X size={20} />
          </Button>
        </DialogHeader>

        {step === 'upload' && (
          <div className="space-y-4 py-8">
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <CloudArrowUp size={64} className="text-primary" weight="duotone" />
              </div>
              <p className="text-muted-foreground">
                Select multiple bird photos from your device
              </p>
              <Button
                size="lg"
                onClick={() => fileInputRef.current?.click()}
                className="bg-accent text-accent-foreground"
              >
                Choose Photos
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>
          </div>
        )}

        {step === 'processing' && (
          <div className="space-y-4 py-8">
            <Progress value={progress} className="w-full" />
            <p className="text-center text-sm text-muted-foreground">
              {progress < 100
                ? 'Processing photos...'
                : 'Running AI identification...'}
            </p>
          </div>
        )}

        {step === 'review' && clusters[currentClusterIndex] && (
          <OutingReview
            cluster={clusters[currentClusterIndex]}
            data={data}
            userId={userId}
            onConfirm={handleOutingConfirmed}
          />
        )}

        {step === 'species' && (
          <SpeciesConfirmation
            cluster={clusters[currentClusterIndex]}
            suggestions={suggestions}
            data={data}
            onComplete={handleSpeciesConfirmed}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
