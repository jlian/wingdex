import { useState, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { X, CloudArrowUp, MapPin } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { extractEXIF, generateThumbnail, computeFileHash } from '@/lib/photo-utils'
import { clusterPhotosIntoOutings } from '@/lib/clustering'
import { identifyBirdInPhoto, aggregateSpeciesSuggestions, suggestBirdCrop } from '@/lib/ai-inference'
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
  aiCropped?: boolean
}

export default function AddPhotosFlow({ data, onClose, userId }: AddPhotosFlowProps) {
  const [step, setStep] = useState<FlowStep>('upload')
  const [photos, setPhotos] = useState<PhotoWithCrop[]>([])
  const [currentClusterIndex, setCurrentClusterIndex] = useState(0)
  const [suggestions, setSuggestions] = useState<SpeciesSuggestion[]>([])
  const [progress, setProgress] = useState(0)
  const [currentCropPhotoIndex, setCurrentCropPhotoIndex] = useState<number | null>(null)
  const [processingMessage, setProcessingMessage] = useState('')
  const [useGeoContext, setUseGeoContext] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Seed default location from user's most recent outing
  const [lastLocationName, setLastLocationName] = useState(() => {
    const sorted = [...data.outings].sort((a, b) =>
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    )
    return sorted[0]?.locationName || ''
  })

  const clusters = photos.length > 0 ? clusterPhotosIntoOutings(photos) : []

  const runInference = async (clusterPhotos: PhotoWithCrop[], outingId: string) => {
    setStep('processing')
    setProgress(0)
    setProcessingMessage('Running AI bird identification...')

    const photoResults = new Map<string, any[]>()
    const totalSteps = clusterPhotos.length * 2

    for (let i = 0; i < clusterPhotos.length; i++) {
      const photo = clusterPhotos[i]
      
      try {
        setProcessingMessage(`Photo ${i + 1}/${clusterPhotos.length}: Detecting bird location...`)
        
        const imageToAnalyze = photo.croppedDataUrl || photo.dataUrl
        
        // Step 1: AI crop detection (only if no existing crop)
        let finalImage = imageToAnalyze
        if (!photo.croppedDataUrl) {
          console.log(`🔍 Photo ${i + 1}: Starting AI crop detection`)
          const cropSuggestion = await suggestBirdCrop(imageToAnalyze)
          setProgress(((i * 2 + 1) / totalSteps) * 100)
          
          if (cropSuggestion) {
            console.log(`✂️ Photo ${i + 1}: Applying AI crop (confidence: ${cropSuggestion.confidence})`)
            const img = new Image()
            await new Promise((resolve, reject) => {
              img.onload = resolve
              img.onerror = reject
              img.src = imageToAnalyze
            })
            
            const canvas = document.createElement('canvas')
            const ctx = canvas.getContext('2d')
            if (ctx) {
              // Add 25% padding around the detected bird so it isn't clipped
              const pad = 0.25
              const rawX = (cropSuggestion.x / 100) * img.width
              const rawY = (cropSuggestion.y / 100) * img.height
              const rawW = (cropSuggestion.width / 100) * img.width
              const rawH = (cropSuggestion.height / 100) * img.height
              const padX = rawW * pad
              const padY = rawH * pad
              const cropX = Math.max(0, rawX - padX)
              const cropY = Math.max(0, rawY - padY)
              const cropWidth = Math.min(img.width - cropX, rawW + padX * 2)
              const cropHeight = Math.min(img.height - cropY, rawH + padY * 2)
              
              canvas.width = Math.round(cropWidth)
              canvas.height = Math.round(cropHeight)
              
              ctx.drawImage(
                img,
                cropX, cropY, cropWidth, cropHeight,
                0, 0, canvas.width, canvas.height
              )
              
              finalImage = canvas.toDataURL('image/jpeg', 0.85)
              
              setPhotos(prev => prev.map(p => 
                p.id === photo.id ? { ...p, croppedDataUrl: finalImage, aiCropped: true } : p
              ))
              
              toast.success(`🤖 AI cropped bird in photo ${i + 1}`, { duration: 2000 })
            }
          } else {
            console.log(`⚠️ Photo ${i + 1}: No crop found, using full image`)
          }
        } else {
          console.log(`✅ Photo ${i + 1}: Using existing crop`)
          setProgress(((i * 2 + 1) / totalSteps) * 100)
        }
        
        // Step 2: Bird species identification (identifyBirdInPhoto handles its own compression)
        // Add a small delay between API calls to avoid rate limiting
        await new Promise(r => setTimeout(r, 800))
        setProcessingMessage(`Photo ${i + 1}/${clusterPhotos.length}: Identifying species...`)
        console.log(`🐦 Photo ${i + 1}: Starting bird identification`)
        
        const results = await identifyBirdInPhoto(
          finalImage,
          useGeoContext ? photo.gps : undefined,
          useGeoContext && photo.exifTime ? new Date(photo.exifTime).getMonth() : undefined
        )
        
        console.log(`✅ Photo ${i + 1}: Found ${results.length} bird candidates`)
        photoResults.set(photo.id, results)
      } catch (error) {
        console.error(`❌ Photo ${i + 1}: Inference failed:`, error)
        toast.error(`Failed to identify photo ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }

      setProgress(((i * 2 + 2) / totalSteps) * 100)
      
      // Rate-limit: wait between consecutive photos
      if (i < clusterPhotos.length - 1) {
        await new Promise(r => setTimeout(r, 500))
      }
    }

    console.log('📊 Aggregating species suggestions from all photos...')
    const aggregated = aggregateSpeciesSuggestions(photoResults)
    console.log(`✅ Aggregation complete: ${aggregated.length} species found`)
    
    if (aggregated.length === 0) {
      console.warn('⚠️ No birds identified in any photo')
      toast.error('No birds identified. Try manually cropping photos to focus on the bird.', { duration: 5000 })
    } else {
      console.log('🎉 Species identified:', aggregated.map(s => `${s.speciesName} (${Math.round(s.confidence * 100)}%)`))
      toast.success(`Found ${aggregated.length} bird species!`, { duration: 3000 })
    }
    
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
        console.log(`📷 ${file.name}: EXIF = time:${exif.timestamp || 'none'}, GPS:${exif.gps ? `${exif.gps.lat.toFixed(4)},${exif.gps.lon.toFixed(4)}` : 'none'}`)
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
    setStep('review')
  }

  const handleOutingConfirmed = async (
    outingId: string,
    locationName: string,
    lat?: number,
    lon?: number
  ) => {
    // Remember location for subsequent outings in this batch
    if (locationName && locationName !== 'Unknown Location') {
      setLastLocationName(locationName)
    }
    const cluster = clusters[currentClusterIndex]
    
    const updatedPhotos = cluster.photos.map((p: any) => {
      const fullPhoto = photos.find(fp => fp.id === p.id)
      return {
        ...fullPhoto,
        outingId
      }
    })

    data.addPhotos(updatedPhotos as Photo[])
    
    const photosForInference = updatedPhotos as PhotoWithCrop[]
    setPhotos(prev => prev.map(p => {
      const updated = photosForInference.find(up => up.id === p.id)
      return updated || p
    }))

    await runInference(photosForInference, outingId)
  }

  const handleCropPhoto = (photoIndex: number) => {
    const cluster = clusters[currentClusterIndex]
    const photoId = cluster.photos[photoIndex].id
    const actualPhotoIndex = photos.findIndex(p => p.id === photoId)
    
    if (actualPhotoIndex !== -1) {
      setCurrentCropPhotoIndex(actualPhotoIndex)
      setStep('crop')
    }
  }

  const handleCropApplied = async (croppedImageUrl: string) => {
    if (currentCropPhotoIndex === null) return
    
    const updatedPhotos = [...photos]
    updatedPhotos[currentCropPhotoIndex] = {
      ...updatedPhotos[currentCropPhotoIndex],
      croppedDataUrl: croppedImageUrl,
      aiCropped: false
    }
    setPhotos(updatedPhotos)
    
    toast.success('Crop applied - re-running identification...')
    setCurrentCropPhotoIndex(null)
    
    const cluster = clusters[currentClusterIndex]
    const photo = updatedPhotos[currentCropPhotoIndex]
    
    setProcessingMessage('Re-running AI identification with cropped image...')
    setProgress(0)
    setStep('processing')
    
    try {
      const results = await identifyBirdInPhoto(
        croppedImageUrl,
        photo.gps,
        photo.exifTime ? new Date(photo.exifTime).getMonth() : undefined
      )
      
      const newResults = new Map<string, any[]>()
      
      cluster.photos.forEach((clusterPhoto: any) => {
        const fullPhoto = updatedPhotos.find(p => p.id === clusterPhoto.id)
        if (fullPhoto?.id === photo.id) {
          newResults.set(photo.id, results)
        } else {
          const existingSuggestion = suggestions.find(s => 
            s.supportingPhotos.includes(clusterPhoto.id)
          )
          if (existingSuggestion) {
            newResults.set(clusterPhoto.id, [{
              species: existingSuggestion.speciesName,
              confidence: existingSuggestion.confidence
            }])
          }
        }
      })
      
      const aggregated = aggregateSpeciesSuggestions(newResults)
      setSuggestions(aggregated)
      setProgress(100)
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

              <div
                className="flex items-center justify-center gap-2 cursor-pointer select-none"
                onClick={() => setUseGeoContext(prev => !prev)}
              >
                <div className={`w-9 h-5 rounded-full relative transition-colors ${useGeoContext ? 'bg-primary' : 'bg-muted'}`}>
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${useGeoContext ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </div>
                <MapPin size={16} className="text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Use GPS &amp; date for better species ID
                </span>
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
              autoConfirm={!!clusters[currentClusterIndex]?.centerLat}
              defaultLocationName={lastLocationName}
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
