import { useState, useRef, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  CloudArrowUp, MapPin, CheckCircle, Question,
  Crop, ArrowRight, ArrowLeft, SkipForward, Scissors
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { extractEXIF, generateThumbnail, computeFileHash } from '@/lib/photo-utils'
import { clusterPhotosIntoOutings } from '@/lib/clustering'
import { identifyBirdInPhoto } from '@/lib/ai-inference'
import type { BirdIdResult } from '@/lib/ai-inference'
import OutingReview from '@/components/flows/OutingReview'
import { getDisplayName, getScientificName } from '@/lib/utils'
import ImageCropDialog from '@/components/ui/image-crop-dialog'
import { Confetti } from '@/components/ui/confetti'
import type { BirdDexDataStore } from '@/hooks/use-birddex-data'
import type { Photo, ObservationStatus } from '@/lib/types'
import {
  needsCloseConfirmation,
  resolvePhotoResults,
  filterConfirmedResults,
} from '@/lib/add-photos-helpers'
import type { FlowStep, PhotoResult } from '@/lib/add-photos-helpers'

interface AddPhotosFlowProps {
  data: BirdDexDataStore
  onClose: () => void
  userId: number
}

interface PhotoWithCrop extends Photo {
  croppedDataUrl?: string
  aiCropped?: boolean
  aiCropBox?: { x: number; y: number; width: number; height: number }
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

  const [showConfetti, setShowConfetti] = useState(false)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)

  const handleOpenChange = (open: boolean) => {
    if (!open && needsCloseConfirmation(step)) {
      setShowCloseConfirm(true)
    } else {
      onClose()
    }
  }

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
          : undefined,
        useGeoContext ? lastLocationName : undefined
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
      const msg = error instanceof Error ? error.message : 'Species identification failed'
      toast.error(msg)
      setCurrentCandidates([])
      setStep('photo-confirm')
    }
  }

  // ─── Advance to next photo or finish ─────────────────────
  const advanceToNextPhoto = (results?: PhotoResult[]) => {
    const finalResults = resolvePhotoResults(results, photoResults)
    const nextIdx = currentPhotoIndex + 1
    if (nextIdx < clusterPhotos.length) {
      setCurrentCandidates([])
      setTimeout(() => runSpeciesId(nextIdx), 300)
    } else {
      saveOuting(finalResults)
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
    const confirmed = filterConfirmedResults(allResults)

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
      const { newSpeciesCount } = data.updateDex(currentOutingId, observations)

      if (newSpeciesCount > 0) {
        setShowConfetti(true)
        toast.success(
          `🎉 ${newSpeciesCount} new species added to your BirdDex!`
        )
        setTimeout(() => setShowConfetti(false), 3500)
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
      setTimeout(onClose, 3500)
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
    // Persist only metadata — strip large base64 blobs to avoid KV/localStorage overflow
    const photosForStorage = updatedPhotos.map((p: any) => ({
      id: p.id,
      outingId: p.outingId,
      dataUrl: '',      // ephemeral — not persisted
      thumbnail: '',    // ephemeral — not persisted
      exifTime: p.exifTime,
      gps: p.gps,
      fileHash: p.fileHash,
      fileName: p.fileName,
    }))
    data.addPhotos(photosForStorage as Photo[])
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
      <AlertDialog open={showCloseConfirm} onOpenChange={setShowCloseConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard progress?</AlertDialogTitle>
            <AlertDialogDescription>
              Your upload is still in progress. If you close now, any unsaved changes will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continue uploading</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={onClose}>Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={step !== 'photo-manual-crop'} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">{getTitle()}</DialogTitle>
          </DialogHeader>

          {/* Upload */}
          {step === 'upload' && (
            <div className="space-y-5 py-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full rounded-xl border-2 border-dashed border-border hover:border-primary/50 hover:bg-muted/40 transition-colors py-10 flex flex-col items-center gap-3 cursor-pointer"
              >
                <CloudArrowUp size={48} className="text-primary" weight="duotone" />
                <div className="space-y-1 text-center">
                  <p className="text-sm font-medium text-foreground">Select Photos</p>
                  <p className="text-xs text-muted-foreground">
                    Bird photos only. Used for ID, never saved.
                  </p>
                </div>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />

              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2.5">
                <Label htmlFor="geo-context" className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer">
                  <MapPin size={16} className="text-primary/70" />
                  Use GPS &amp; date for better ID
                </Label>
                <Switch
                  id="geo-context"
                  checked={useGeoContext}
                  onCheckedChange={setUseGeoContext}
                />
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div className="flex items-start gap-2 rounded-lg bg-muted/20 p-2.5">
                  <span className="text-primary mt-0.5">✦</span>
                  <span>Close-ups and side profiles ID best</span>
                </div>
                <div className="flex items-start gap-2 rounded-lg bg-muted/20 p-2.5">
                  <span className="text-primary mt-0.5">✦</span>
                  <span>One bird per photo for accuracy</span>
                </div>
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
              autoLookupGps={useGeoContext}
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
              onBack={currentPhotoIndex > 0 ? () => {
                // Remove the last result (for the previous photo) and go back
                setPhotoResults(prev => prev.slice(0, -1))
                setCurrentCandidates([])
                runSpeciesId(currentPhotoIndex - 1)
              } : undefined}
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
          onCancel={() => {
            // Go back to confirm screen (showing no-results) rather than silently skipping
            setCurrentCandidates([])
            setStep('photo-confirm')
          }}
          open={true}
          initialCropBox={fullCurrentPhoto.aiCropBox}
        />
      )}

      <Confetti active={showConfetti} />
    </>
  )
}

// ────────────────────────────────────────────────────────────
//  AI Zoomed preview — renders the crop box region onto a canvas
// ────────────────────────────────────────────────────────────

function AiZoomedPreview({
  imageUrl,
  cropBox,
}: {
  imageUrl: string
  cropBox: { x: number; y: number; width: number; height: number }
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      const canvas = canvasRef.current
      if (!canvas) return

      // cropBox is percentage coords (0-100) — convert to pixels with padding
      const pad = 0.15
      const rawX = (cropBox.x / 100) * img.naturalWidth
      const rawY = (cropBox.y / 100) * img.naturalHeight
      const rawW = (cropBox.width / 100) * img.naturalWidth
      const rawH = (cropBox.height / 100) * img.naturalHeight
      const padX = rawW * pad
      const padY = rawH * pad

      const sx = Math.max(0, rawX - padX)
      const sy = Math.max(0, rawY - padY)
      const sw = Math.min(rawW + padX * 2, img.naturalWidth - sx)
      const sh = Math.min(rawH + padY * 2, img.naturalHeight - sy)

      // Size canvas to fit the crop aspect ratio, max 320px wide
      const maxW = 320
      const scale = Math.min(maxW / sw, 224 / sh, 1) // also cap height at 224px
      canvas.width = Math.round(sw * scale)
      canvas.height = Math.round(sh * scale)

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
    }
    img.src = imageUrl
  }, [imageUrl, cropBox])

  return (
    <div className="relative inline-block">
      <canvas
        ref={canvasRef}
        className="rounded-lg border-2 border-accent max-h-56"
      />
      <div className="absolute top-1.5 right-1.5 p-1 rounded-full bg-accent/80 text-accent-foreground shadow" title="AI auto-cropped">
        <Scissors size={14} weight="bold" />
      </div>
    </div>
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
  onBack?: () => void
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
  onBack,
  onRecrop,
  aiCropBox
}: PerPhotoConfirmProps) {
  const displayImage = photo.croppedDataUrl || photo.thumbnail
  const isAICropped = !!photo.aiCropped
  const topCandidate = candidates[0]
  const [showAlternatives, setShowAlternatives] = useState(false)
  const [selectedSpecies, setSelectedSpecies] = useState(topCandidate?.species ?? '')
  const [selectedConfidence, setSelectedConfidence] = useState(topCandidate?.confidence ?? 0)
  const [count, setCount] = useState(1)
  const isHighConfidence = selectedConfidence >= 0.8

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
  }

  const confidencePct = Math.round(selectedConfidence * 100)
  const displayName = getDisplayName(selectedSpecies)
  const scientificMatch = selectedSpecies.match(/\(([^)]+)\)/)
  const scientificName = scientificMatch ? scientificMatch[1] : ''

  return (
    <div className="space-y-4">
      {/* Photo — zoomed to bird if AI crop box available */}
      <div className="flex justify-center relative">
        {aiCropBox && !photo.croppedDataUrl ? (
          <AiZoomedPreview
            imageUrl={photo.dataUrl || photo.thumbnail}
            cropBox={aiCropBox}
          />
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
            <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
              <CheckCircle size={16} weight="fill" />
              <span>High confidence, auto-selected</span>
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
                  All possibilities
                </p>
                {candidates.map(c => {
                  const altName = getDisplayName(c.species)
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
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft size={16} className="mr-1" />
            Back
          </Button>
        )}
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
