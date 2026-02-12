import { useState, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { X, CloudArrowUp, Crop } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { extractEXIF, generateThumbnail, computeFileHash, downscaleForInference } from '@/lib/photo-utils'
import { clusterPhotosIntoOutings } from '@/lib/clustering'
import { identifyBirdInPhoto, aggregateSpeciesSuggestions } from '@/lib/ai-inference'
import OutingReview from '@/components/flows/OutingReview'
import SpeciesConfirmation from '@/components/flows/SpeciesConfirmation'
import ImageCropDialog from '@/components/ui/image-crop-dialog'
import type { useBirdDexData } from '@/hooks/use-birddex-data'
import type { Photo, SpeciesSuggestion } from '@/lib/types'

interface AddPhotosFlowProps {
  data: ReturnType<typeof useBirdDexData>
  onClose: () => void
  userId: number
}

type FlowStep = 'upload' | 'processing' | 'review' | 'crop' | 'species' | 'complete'

interface PhotoWithCrop extends Photo {
  croppedDataUrl?: string
}

export default function AddPhotosFlow({ data, onClose, userId }: AddPhotosFlowProps) {
  const [step, setStep] = useState<FlowStep>('upload')
  const [photos, setPhotos] = useState<PhotoWithCrop[]>([])
  const [currentClusterIndex, setCurrentClusterIndex] = useState(0)
  const [suggestions, setSuggestions] = useState<SpeciesSuggestion[]>([])
  const [progress, setProgress] = useState(0)
  const [currentCropPhotoIndex, setCurrentCropPhotoIndex] = useState<number | null>(null)
  const [processingMessage, setProcessingMessage] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const clusters = photos.length > 0 ? clusterPhotosIntoOutings(photos) : []

  const runInference = async (clusterPhotos: PhotoWithCrop[], outingId: string) => {
    setStep('processing')
    setProgress(0)
    setProcessingMessage('Running AI bird identification...')

    const photoResults = new Map<string, any[]>()

    for (let i = 0; i < clusterPhotos.length; i++) {
      const photo = clusterPhotos[i]
      
      try {
        const imageToAnalyze = photo.croppedDataUrl || photo.dataUrl
        const downscaled = await downscaleForInference(imageToAnalyze, 1200)
        
        const results = await identifyBirdInPhoto(
          downscaled,
          photo.gps,
          photo.exifTime ? new Date(photo.exifTime).getMonth() : undefined
        )
        
        photoResults.set(photo.id, results)
      } catch (error) {
        console.error('Inference failed for photo:', error)
      }

      setProgress(((i + 1) / clusterPhotos.length) * 100)
    }

    const aggregated = aggregateSpeciesSuggestions(photoResults)
    setSuggestions(aggregated)
    setStep('species')
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    setStep('processing')
    setProgress(0)
    setProcessingMessage('Extracting EXIF data and clustering photos...')

    const processedPhotos: PhotoWithCrop[] = []

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

        const photo: PhotoWithCrop = {
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
    
    const photoClusters = clusterPhotosIntoOutings(processedPhotos)
    
    if (photoClusters.length > 0) {
      const firstCluster = photoClusters[0]
      const outingId = `outing_${Date.now()}`
      
      const outing = {
        id: outingId,
        userId: userId.toString(),
        startTime: firstCluster.startTime.toISOString(),
        endTime: firstCluster.endTime.toISOString(),
        locationName: firstCluster.centerLat && firstCluster.centerLon 
          ? `${firstCluster.centerLat.toFixed(4)}, ${firstCluster.centerLon.toFixed(4)}`
          : 'Unknown Location',
        lat: firstCluster.centerLat,
        lon: firstCluster.centerLon,
        notes: '',
        createdAt: new Date().toISOString()
      }

      data.addOuting(outing)
      
      const updatedPhotos = firstCluster.photos.map(p => ({
        ...p,
        outingId
      }))

      data.addPhotos(updatedPhotos as Photo[])
      setPhotos(updatedPhotos as PhotoWithCrop[])

      toast.success(`Outing automatically created from EXIF data`)
      
      await runInference(updatedPhotos as PhotoWithCrop[], outingId)
    } else {
      setStep('review')
    }
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

    await runInference(updatedPhotos as PhotoWithCrop[], outingId)
  }

  const handleCropPhoto = (photoIndex: number) => {
    setCurrentCropPhotoIndex(photoIndex)
    setStep('crop')
  }

  const handleCropApplied = async (croppedImageUrl: string) => {
    if (currentCropPhotoIndex === null) return
    
    setPhotos(prev => {
      const updated = [...prev]
      updated[currentCropPhotoIndex] = {
        ...updated[currentCropPhotoIndex],
        croppedDataUrl: croppedImageUrl
      }
      return updated
    })
    
    toast.success('Crop applied - will use cropped version for identification')
    setCurrentCropPhotoIndex(null)
    setStep('species')
    
    const cluster = clusters[currentClusterIndex]
    const photo = photos[currentCropPhotoIndex]
    
    setProcessingMessage('Re-running AI identification with cropped image...')
    setProgress(0)
    setStep('processing')
    
    try {
      const downscaled = await downscaleForInference(croppedImageUrl, 1200)
      const results = await identifyBirdInPhoto(
        downscaled,
        photo.gps,
        photo.exifTime ? new Date(photo.exifTime).getMonth() : undefined
      )
      
      const newResults = new Map<string, any[]>()
      newResults.set(photo.id, results)
      
      suggestions.forEach(s => {
        const otherPhotos = s.supportingPhotos.filter(pid => pid !== photo.id)
        if (otherPhotos.length > 0) {
          otherPhotos.forEach(pid => {
            if (!newResults.has(pid)) {
              newResults.set(pid, [{ species: s.speciesName, confidence: s.confidence }])
            }
          })
        }
      })
      
      const aggregated = aggregateSpeciesSuggestions(newResults)
      setSuggestions(aggregated)
      setStep('species')
    } catch (error) {
      console.error('Re-inference failed:', error)
      toast.error('Failed to re-identify bird')
      setStep('species')
    }
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
    <>
      <Dialog open={step !== 'crop'} onOpenChange={onClose}>
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
                {processingMessage || 'Processing...'}
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
              photos={photos}
              onComplete={handleSpeciesConfirmed}
              onCropPhoto={handleCropPhoto}
            />
          )}
        </DialogContent>
      </Dialog>

      {step === 'crop' && currentCropPhotoIndex !== null && (
        <ImageCropDialog
          imageUrl={photos[currentCropPhotoIndex].dataUrl}
          onCrop={handleCropApplied}
          onCancel={() => {
            setCurrentCropPhotoIndex(null)
            setStep('species')
          }}
          open={true}
        />
      )}
    </>
  )
}
