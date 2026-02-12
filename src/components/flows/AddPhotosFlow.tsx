import { useState, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  X, CloudArrowUp, MapPin, CheckCircle, Question,
  Crop, ArrowRight, SkipForward
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { extractEXIF, generateThumbnail, computeFileHash } from '@/lib/photo-utils'
import { clusterPhotosIntoOutings } from '@/lib/clustering'
import { identifyBirdInPhoto } from '@/lib/ai-inference'
import type { BirdIdResult } from '@/lib/ai-inference'
import OutingReview from '@/components/flows/OutingReview'
import ImageCropDialog from '@/components/ui/image-crop-dialog'
import type { useBirdDexData } from '@/hooks/use-birddex-data'
import type { Photo, ObservationStatus } from '@/lib/types'

interface AddPhotosFlowProps {
  data: ReturnType<typeof useBirdDexData>
  onClose: () => void
  userId: number
}

type FlowStep =
  | 'upload'
  | 'extracting'
  | 'review'
  | 'photo-manual-crop'
  | 'photo-processing'
  | 'photo-confirm'
  | 'complete'

interface PhotoWithCrop extends Photo {
  croppedDataUrl?: string
  aiCropped?: boolean
  aiCropBox?: { x: number; y: number; width: number; height: number }
}

interface PhotoResult {
  photoId: string
  species: string
  confidence: number
  status: ObservationStatus
  count: number
}

export default function AddPhotosFlow({ data, onClose, userId }: AddPhotosFlowProps) {
  const [step, setStep] = useState<FlowStep>('upload')
  const [photos, setPhotos] = useState<PhotoWithCrop[]>([])
  const [currentClusterIndex, setCurrentClusterIndex] = useState(0)
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0)
  const [progress, setProgress] = useState(0)
  const [processingMessage, setProcessingMessage] = useState('')
  const [useGeoContext, setUseGeoContext] = useState(true)
  const [currentOutingId, setCurrentOutingId] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [photoResults, setPhotoResults] = useState<PhotoResult[]>([])
  const [currentCandidates, setCurrentCandidates] = useState<
    { species: string; confidence: number }[]
  >([])

  const [lastLocationName, setLastLocationName] = useState(() => {
    const sorted = [...data.outings].sort(
      (a, b) =>
        new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    )
    return sorted[0]?.locationName || ''
  })

  const clusters = photos.length > 0 ? clusterPhotosIntoOutings(photos) : []
  const clusterPhotos = clusters[currentClusterIndex]?.photos ?? []

  // Get the full photo object (with croppedDataUrl etc) from the photos array
  const getFullPhoto = (idx: number): PhotoWithCrop | undefined => {
    const clusterPhoto = clusterPhotos[idx]
    if (!clusterPhoto) return undefined
    return photos.find(p => p.id === clusterPhoto.id) ?? (clusterPhoto as PhotoWithCrop)
  }

  const fullCurrentPhoto = getFullPhoto(currentPhotoIndex)

  // ─── Step 1: Send full image directly to species ID ─────
  const runSpeciesId = async (photoIdx: number, imageUrl?: string) => {
    const photo = getFullPhoto(photoIdx)
    if (!photo) return

    setCurrentPhotoIndex(photoIdx)
    setStep('photo-processing')
    const analyzeUrl = imageUrl || photo.croppedDataUrl || photo.dataUrl
    setProcessingMessage(
      `Photo ${photoIdx + 1}/${clusterPhotos.length}: Identifying species...`
    )

    try {
      await new Promise(r => setTimeout(r, 500))
      const result: BirdIdResult = await identifyBirdInPhoto(
        analyzeUrl,
        useGeoContext ? photo.gps : undefined,
        useGeoContext && photo.exifTime
          ? new Date(photo.exifTime).getMonth()
          : undefined
      )
      console.log(`✅ Found ${result.candidates.length} candidates`)

      // Store AI crop box on the photo if we got one
      if (result.cropBox) {
        setPhotos(prev =>
          prev.map(p =>
            p.id === photo.id ? { ...p, aiCropBox: result.cropBox } : p
          )
        )
      }

      if (result.candidates.length === 0 && !imageUrl) {
        // No species found on full image — ask user to crop and retry
        console.log('⚠️ No species identified — asking user to crop or skip')
        setStep('photo-manual-crop')
      } else {
        setCurrentCandidates(result.candidates)
        setStep('photo-confirm')
      }
    } catch (error) {
      console.error('Species ID failed:', error)
      toast.error('Species identification failed')
      setCurrentCandidates([])
      setStep('photo-confirm')
    }
  }

  // ─── Advance to next photo or finish ─────────────────────
  const advanceToNextPhoto = (results?: PhotoResult[]) => {
    const nextIdx = currentPhotoIndex + 1
    if (nextIdx < clusterPhotos.length) {
      setCurrentCandidates([])
      setTimeout(() => runSpeciesId(nextIdx), 300)
    } else {
      saveOuting(results ?? photoResults)
    }
  }

  // ─── User confirms species for current photo ─────────────
  const confirmCurrentPhoto = (
    species: string,
    confidence: number,
    status: ObservationStatus,
    count: number
  ) => {
    const newResult: PhotoResult = {
      photoId: fullCurrentPhoto!.id, species, confidence, status, count
    }
    const updatedResults = [...photoResults, newResult]
    setPhotoResults(updatedResults)
    advanceToNextPhoto(updatedResults)
  }

  // ─── Save all observations and finish ────────────────────
  const saveOuting = (allResults: PhotoResult[]) => {
    const confirmed = allResults.filter(
      r => r.status === 'confirmed' || r.status === 'possible'
    )

    const speciesMap = new Map<
      string,
      { count: number; status: ObservationStatus; photoId: string }
    >()
    for (const r of confirmed) {
      const existing = speciesMap.get(r.species)
      if (existing) {
        existing.count += r.count
      } else {
        speciesMap.set(r.species, {
          count: r.count,
          status: r.status,
          photoId: r.photoId
        })
      }
    }

    const observations = Array.from(speciesMap.entries()).map(
      ([species, info]) => ({
        id: `obs_${Date.now()}_${species.replace(/\s/g, '_')}`,
        outingId: currentOutingId,
        speciesName: species,
        count: info.count,
        certainty: info.status,
        representativePhotoId: info.photoId,
        notes: ''
      })
    )

    if (observations.length > 0) {
      data.addObservations(observations)
      data.updateLifeList(currentOutingId, observations)

      const newSpecies = observations.filter(obs => {
        const existing = data.getLifeListEntry(obs.speciesName)
        return !existing || existing.totalOutings === 1
      })
      if (newSpecies.length > 0) {
        toast.success(
          `🎉 ${newSpecies.length} new species added to your life list!`
        )
      }
    }

    if (currentClusterIndex < clusters.length - 1) {
      setCurrentClusterIndex(prev => prev + 1)
      setCurrentPhotoIndex(0)
      setPhotoResults([])
      setCurrentCandidates([])
      setStep('review')
    } else {
      toast.success(`All done! ${confirmed.length} species saved.`)
      setStep('complete')
      setTimeout(onClose, 1500)
    }
  }

  // ─── File selection handler ──────────────────────────────
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    setStep('extracting')
    setProgress(0)
    setProcessingMessage('Reading photo data...')

    const processedPhotos: PhotoWithCrop[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      try {
        const exif = await extractEXIF(file)
        console.log(
          `📷 ${file.name}: EXIF = time:${exif.timestamp || 'none'}, GPS:${
            exif.gps
              ? `${exif.gps.lat.toFixed(4)},${exif.gps.lon.toFixed(4)}`
              : 'none'
          }`
        )
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
        const dataUrl = await new Promise<string>(resolve => {
          reader.onload = () => resolve(reader.result as string)
          reader.readAsDataURL(file)
        })

        processedPhotos.push({
          id: `photo_${Date.now()}_${i}`,
          outingId: '',
          dataUrl,
          thumbnail,
          exifTime: exif.timestamp,
          gps: exif.gps,
          fileHash: hash,
          fileName: file.name
        })
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

  // ─── Outing confirmed → start per-photo loop ────────────
  const handleOutingConfirmed = async (
    outingId: string,
    locationName: string
  ) => {
    if (locationName && locationName !== 'Unknown Location') {
      setLastLocationName(locationName)
    }
    setCurrentOutingId(outingId)

    const cluster = clusters[currentClusterIndex]
    const updatedPhotos = cluster.photos.map((p: any) => {
      const fullPhoto = photos.find(fp => fp.id === p.id)
      return { ...fullPhoto, outingId }
    })
    data.addPhotos(updatedPhotos as Photo[])
    setPhotos(prev =>
      prev.map(p => {
        const updated = updatedPhotos.find((up: any) => up.id === p.id)
        return (updated as PhotoWithCrop) || p
      })
    )

    setPhotoResults([])
    setCurrentCandidates([])
    runSpeciesId(0)
  }

  // ─── Manual crop callback ───────────────────────────────
  const handleManualCrop = async (croppedImageUrl: string) => {
    if (!fullCurrentPhoto) return
    setPhotos(prev =>
      prev.map(p =>
        p.id === fullCurrentPhoto.id
          ? { ...p, croppedDataUrl: croppedImageUrl, aiCropped: false }
          : p
      )
    )
    // After manual crop, send cropped image to species ID (pass imageUrl so we don't re-prompt for crop)
    await runSpeciesId(currentPhotoIndex, croppedImageUrl)
  }

  // ─── Title ──────────────────────────────────────────────
  const getTitle = () => {
    switch (step) {
      case 'upload': return 'Add Photos'
      case 'extracting': return 'Reading Photos...'
      case 'review':
        return `Review Outing${clusters.length > 1 ? ` ${currentClusterIndex + 1} of ${clusters.length}` : ''}`
      case 'photo-processing':
      case 'photo-confirm':
        return `Photo ${currentPhotoIndex + 1} of ${clusterPhotos.length}`
      case 'photo-manual-crop':
        return `Crop Photo ${currentPhotoIndex + 1}`
      case 'complete': return 'Complete!'
      default: return 'Add Photos'
    }
  }

  return (
    <>
      <Dialog open={step !== 'photo-manual-crop'} onOpenChange={onClose}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">{getTitle()}</DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-4 top-4"
              onClick={onClose}
            >
              <X size={20} />
            </Button>
          </DialogHeader>

          {/* Upload */}
          {step === 'upload' && (
            <div className="space-y-4 py-8">
              <div className="text-center space-y-4">
                <div className="flex justify-center">
                  <CloudArrowUp size={64} className="text-primary" weight="duotone" />
                </div>
                <p className="text-muted-foreground">
                  Select bird photos from your device
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

          {/* Extracting EXIF */}
          {step === 'extracting' && (
            <div className="space-y-4 py-8">
              <Progress value={progress} className="w-full" />
              <p className="text-center text-sm text-muted-foreground">
                {processingMessage}
              </p>
            </div>
          )}

          {/* Outing Review */}
          {step === 'review' && clusters[currentClusterIndex] && (
            <OutingReview
              cluster={clusters[currentClusterIndex]}
              data={data}
              userId={userId}
              defaultLocationName={lastLocationName}
              onConfirm={handleOutingConfirmed}
            />
          )}

          {/* Photo crop / processing spinner */}
          {step === 'photo-processing' && (
            <div className="space-y-4 py-8">
              {fullCurrentPhoto && (
                <div className="flex justify-center">
                  <img
                    src={fullCurrentPhoto.thumbnail}
                    alt="Current photo"
                    className="w-32 h-32 object-cover rounded-lg border-2 border-border"
                  />
                </div>
              )}
              <Progress value={66} className="w-full" />
              <p className="text-center text-sm text-muted-foreground">
                {processingMessage}
              </p>
              {/* Photo dots */}
              <div className="flex items-center justify-center gap-1">
                {clusterPhotos.map((_, i) => (
                  <div
                    key={i}
                    className={`w-2 h-2 rounded-full ${
                      i < currentPhotoIndex
                        ? 'bg-green-500'
                        : i === currentPhotoIndex
                        ? 'bg-primary animate-pulse'
                        : 'bg-muted'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Per-photo species confirmation */}
          {step === 'photo-confirm' && fullCurrentPhoto && (
            <PerPhotoConfirm
              photo={fullCurrentPhoto}
              candidates={currentCandidates}
              photoIndex={currentPhotoIndex}
              totalPhotos={clusterPhotos.length}
              onConfirm={confirmCurrentPhoto}
              onSkip={advanceToNextPhoto}
              onRecrop={() => setStep('photo-manual-crop')}
              aiCropBox={fullCurrentPhoto.aiCropBox}
            />
          )}

          {/* Complete */}
          {step === 'complete' && (
            <div className="py-8 text-center space-y-4">
              <CheckCircle size={64} weight="fill" className="text-green-500 mx-auto" />
              <p className="text-lg font-semibold">
                {photoResults.filter(r => r.status === 'confirmed').length} species
                confirmed across {clusterPhotos.length} photos
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Manual crop dialog */}
      {step === 'photo-manual-crop' && fullCurrentPhoto && (
        <ImageCropDialog
          imageUrl={fullCurrentPhoto.dataUrl}
          onCrop={handleManualCrop}
          onCancel={() => advanceToNextPhoto()}
          open={true}
          initialCropBox={fullCurrentPhoto.aiCropBox}
        />
      )}
    </>
  )
}

// ────────────────────────────────────────────────────────────
//  Per-photo species confirmation
// ────────────────────────────────────────────────────────────

interface PerPhotoConfirmProps {
  photo: PhotoWithCrop
  candidates: { species: string; confidence: number }[]
  photoIndex: number
  totalPhotos: number
  onConfirm: (
    species: string,
    confidence: number,
    status: ObservationStatus,
    count: number
  ) => void
  onSkip: () => void
  onRecrop: () => void
  aiCropBox?: { x: number; y: number; width: number; height: number }
}

function PerPhotoConfirm({
  photo,
  candidates,
  photoIndex,
  totalPhotos,
  onConfirm,
  onSkip,
  onRecrop,
  aiCropBox
}: PerPhotoConfirmProps) {
  const displayImage = photo.croppedDataUrl || photo.thumbnail
  const isAICropped = !!photo.aiCropped
  const topCandidate = candidates[0]
  const isHighConfidence = topCandidate && topCandidate.confidence >= 0.8
  const [showAlternatives, setShowAlternatives] = useState(false)
  const [selectedSpecies, setSelectedSpecies] = useState(topCandidate?.species ?? '')
  const [selectedConfidence, setSelectedConfidence] = useState(topCandidate?.confidence ?? 0)
  const [count, setCount] = useState(1)

  // No candidates
  if (candidates.length === 0) {
    return (
      <div className="space-y-4 py-4">
        <div className="flex justify-center">
          <img
            src={displayImage}
            alt="Photo"
            className="max-h-48 rounded-lg border-2 border-border object-contain"
          />
        </div>
        <p className="text-center text-muted-foreground">
          No bird species identified in this photo.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onRecrop}>
            <Crop size={16} className="mr-1" weight="bold" />
            Crop &amp; Retry
          </Button>
          <Button variant="ghost" className="flex-1" onClick={onSkip}>
            <SkipForward size={16} className="mr-1" />
            Skip
          </Button>
        </div>
        <PhotoDots current={photoIndex} total={totalPhotos} />
      </div>
    )
  }

  const handleConfirm = (status: ObservationStatus) => {
    onConfirm(selectedSpecies, selectedConfidence, status, count)
  }

  const selectAlternative = (species: string, confidence: number) => {
    setSelectedSpecies(species)
    setSelectedConfidence(confidence)
    setShowAlternatives(false)
  }

  const confidencePct = Math.round(selectedConfidence * 100)
  const displayName = selectedSpecies.split('(')[0].trim()
  const scientificMatch = selectedSpecies.match(/\(([^)]+)\)/)
  const scientificName = scientificMatch ? scientificMatch[1] : ''

  return (
    <div className="space-y-4">
      {/* Photo — zoomed to bird if AI crop box available */}
      <div className="flex justify-center relative">
        {aiCropBox && !photo.croppedDataUrl ? (
          <div
            className="relative max-h-56 rounded-lg overflow-hidden border-2 border-accent"
            style={{ width: '100%', maxWidth: '320px' }}
          >
            <div style={{
              position: 'relative',
              width: '100%',
              paddingBottom: `${(aiCropBox.height / aiCropBox.width) * 100}%`,
              overflow: 'hidden',
            }}>
              <img
                src={photo.dataUrl || photo.thumbnail}
                alt="Bird"
                draggable={false}
                style={{
                  position: 'absolute',
                  left: `${-(aiCropBox.x / aiCropBox.width) * 100}%`,
                  top: `${-(aiCropBox.y / aiCropBox.height) * 100}%`,
                  width: `${(100 / aiCropBox.width) * 100}%`,
                  height: 'auto',
                }}
              />
            </div>
            <div className="absolute top-2 right-2 text-xs px-2 py-1 rounded-full bg-accent text-accent-foreground font-medium shadow">
              🔍 AI Zoomed
            </div>
          </div>
        ) : (
          <img
            src={displayImage}
            alt="Bird"
            className={`max-h-56 rounded-lg object-contain border-2 ${
              isAICropped ? 'border-accent' : 'border-border'
            }`}
          />
        )}
      </div>

      {/* Species result card */}
      <Card className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <h3 className="font-serif text-lg font-semibold text-foreground">
              {displayName}
            </h3>
            {scientificName && (
              <p className="text-sm text-muted-foreground italic">{scientificName}</p>
            )}
          </div>
          <Badge
            variant={isHighConfidence ? 'default' : 'secondary'}
            className={isHighConfidence ? 'bg-green-500 text-white' : ''}
          >
            {confidencePct}%
          </Badge>
        </div>

        {/* Confidence bar */}
        <div className="w-full bg-muted rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${
              confidencePct >= 80
                ? 'bg-green-500'
                : confidencePct >= 50
                ? 'bg-amber-500'
                : 'bg-red-400'
            }`}
            style={{ width: `${confidencePct}%` }}
          />
        </div>

        {isHighConfidence && !showAlternatives ? (
          /* HIGH CONFIDENCE — auto-selected, alternatives hidden */
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle size={16} weight="fill" />
              <span>High confidence — auto-selected</span>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm text-muted-foreground">Count:</label>
              <Input
                type="number"
                min="1"
                value={count}
                onChange={e => setCount(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-20"
              />
            </div>

            <div className="flex gap-2">
              <Button
                className="flex-1 bg-accent text-accent-foreground"
                onClick={() => handleConfirm('confirmed')}
              >
                <CheckCircle size={16} className="mr-1" weight="bold" />
                Confirm
                {photoIndex < totalPhotos - 1 && (
                  <ArrowRight size={14} className="ml-1" />
                )}
              </Button>
              {candidates.length > 1 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAlternatives(true)}
                >
                  {candidates.length - 1} more
                </Button>
              )}
            </div>
          </div>
        ) : (
          /* LOW CONFIDENCE or alternatives expanded */
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" onClick={() => handleConfirm('confirmed')}>
                <CheckCircle size={16} className="mr-1" weight="bold" />
                Confirm
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => handleConfirm('possible')}
              >
                <Question size={16} className="mr-1" weight="bold" />
                Possible
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm text-muted-foreground">Count:</label>
              <Input
                type="number"
                min="1"
                value={count}
                onChange={e => setCount(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-20"
              />
            </div>

            {/* Alternatives */}
            {candidates.length > 1 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                  Other possibilities
                </p>
                {candidates.slice(1).map(c => {
                  const altName = c.species.split('(')[0].trim()
                  const altPct = Math.round(c.confidence * 100)
                  const isSelected = c.species === selectedSpecies
                  return (
                    <button
                      key={c.species}
                      className={`w-full text-left p-2 rounded-md flex items-center justify-between hover:bg-muted/80 transition-colors ${
                        isSelected
                          ? 'bg-primary/10 border border-primary'
                          : 'bg-muted/40'
                      }`}
                      onClick={() => selectAlternative(c.species, c.confidence)}
                    >
                      <span className="text-sm font-medium">{altName}</span>
                      <span className="text-xs text-muted-foreground">{altPct}%</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Bottom actions */}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onRecrop} className="flex-1">
          <Crop size={16} className="mr-1" weight="bold" />
          Re-crop
        </Button>
        <Button variant="ghost" size="sm" onClick={onSkip} className="flex-1">
          <SkipForward size={16} className="mr-1" />
          Skip
        </Button>
      </div>

      <PhotoDots current={photoIndex} total={totalPhotos} />
    </div>
  )
}

function PhotoDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-1">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`w-2 h-2 rounded-full transition-colors ${
            i < current
              ? 'bg-green-500'
              : i === current
              ? 'bg-primary'
              : 'bg-muted'
          }`}
        />
      ))}
    </div>
  )
}
