import { useState, useRef, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Card } from '@/components/ui/card'
import { Confetti } from '@/components/ui/confetti'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  CloudArrowUp, MapPin, CheckCircle, Question,
  Crop, ArrowRight, ArrowLeft, SkipForward
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { extractEXIF, generateThumbnail, computeFileHash } from '@/lib/photo-utils'
import { clusterPhotosIntoOutings } from '@/lib/clustering'
import { identifyBirdInPhoto } from '@/lib/ai-inference'
import type { BirdIdResult } from '@/lib/ai-inference'
import OutingReview from '@/components/flows/OutingReview'
import { getDisplayName, getScientificName } from '@/lib/utils'
import { toLocalISOWithOffset } from '@/lib/timezone'
import ImageCropDialog from '@/components/ui/image-crop-dialog'
import type { WingDexDataStore } from '@/hooks/use-wingdex-data'
import type { Photo, ObservationStatus } from '@/lib/types'
import {
  needsCloseConfirmation,
  resolvePhotoResults,
  filterConfirmedResults,
  normalizeLocationName,
  resolveInferenceLocationName,
} from '@/lib/add-photos-helpers'
import type { FlowStep, PhotoResult } from '@/lib/add-photos-helpers'
import { useBirdImageWithStatus } from '@/hooks/use-bird-image'
import { getWikimediaImage } from '@/lib/wikimedia'
import { computePaddedSquareCropFromPercent } from '@/lib/crop-math'
import { WikiBirdThumbnail } from '@/components/ui/wiki-bird-thumbnail'

interface AddPhotosFlowProps {
  data: WingDexDataStore
  onClose: () => void
  userId: string
}

interface PhotoWithCrop extends Photo {
  croppedDataUrl?: string
  aiCropped?: boolean
  aiCropBox?: { x: number; y: number; width: number; height: number }
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

async function waitForImageLoad(url: string, timeoutMs = 1500): Promise<void> {
  await Promise.race([
    new Promise<void>(resolve => {
      const img = new Image()
      img.onload = () => resolve()
      img.onerror = () => resolve()
      img.src = url
    }),
    wait(timeoutMs),
  ])
}

async function prefetchWikiReference(speciesName?: string): Promise<void> {
  if (!speciesName) return
  const url = await getWikimediaImage(speciesName)
  if (!url) return
  await waitForImageLoad(url)
}

export default function AddPhotosFlow({ data, onClose, userId }: AddPhotosFlowProps) {
  const [step, setStep] = useState<FlowStep>('upload')
  const [photos, setPhotos] = useState<PhotoWithCrop[]>([])
  const [currentClusterIndex, setCurrentClusterIndex] = useState(0)
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0)
  const [progress, setProgress] = useState(0)
  const [photoProgress, setPhotoProgress] = useState(0)
  const [photoProgressTauMs, setPhotoProgressTauMs] = useState(1200)
  const [photoProgressRunKey, setPhotoProgressRunKey] = useState(0)
  const [processingMessage, setProcessingMessage] = useState('')
  const [useGeoContext, setUseGeoContext] = useState(true)
  const [currentOutingId, setCurrentOutingId] = useState('')
  const [showConfetti, setShowConfetti] = useState(false)
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

  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [showDuplicateConfirm, setShowDuplicateConfirm] = useState(false)
  const [pendingNewPhotos, setPendingNewPhotos] = useState<PhotoWithCrop[]>([])
  const [pendingDuplicatePhotos, setPendingDuplicatePhotos] = useState<PhotoWithCrop[]>([])

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

  useEffect(() => {
    if (step !== 'photo-processing') {
      setPhotoProgress(0)
      return
    }

    const startedAt = Date.now()
    setPhotoProgress(0)

    const interval = window.setInterval(() => {
      const elapsed = Date.now() - startedAt
      const next = 90 * (1 - Math.exp(-elapsed / photoProgressTauMs))
      setPhotoProgress(prev => Math.max(prev, Math.min(90, next)))
    }, 80)

    return () => window.clearInterval(interval)
  }, [step, photoProgressRunKey, photoProgressTauMs])

  // ─── Step 1: Send full image directly to species ID ─────
  const runSpeciesId = async (
    photoIdx: number,
    imageUrl?: string,
    locationNameOverride?: string,
  ) => {
    const photo = getFullPhoto(photoIdx)
    if (!photo) return

    setCurrentPhotoIndex(photoIdx)
    setStep('photo-processing')
    setPhotoProgressTauMs(1200)
    setPhotoProgressRunKey(prev => prev + 1)
    const analyzeUrl = imageUrl || photo.croppedDataUrl || photo.dataUrl
    setProcessingMessage(
      `Photo ${photoIdx + 1}/${clusterPhotos.length}: Identifying species...`
    )

    try {
      const fastResult: BirdIdResult = await identifyBirdInPhoto(
        analyzeUrl,
        useGeoContext ? photo.gps : undefined,
        useGeoContext && photo.exifTime
          ? new Date(photo.exifTime).getMonth()
          : undefined,
        resolveInferenceLocationName(
          useGeoContext,
          lastLocationName,
          locationNameOverride,
        ),
        'fast'
      )

      if (!imageUrl && (fastResult.candidates.length === 0 || fastResult.multipleBirds)) {
        setPhotoProgress(100)
        await wait(240)
        if (fastResult.multipleBirds) {
          console.log('Multiple birds detected by fast model, asking user to crop before escalation')
          toast.info('Multiple birds detected, crop to one')
          setCurrentCandidates(fastResult.candidates)
        } else {
          console.log('No species identified by fast model, asking user to crop before escalation')
          setCurrentCandidates([])
        }
        setStep('photo-manual-crop')
        return;
      }

      const topConfidence = fastResult.candidates[0]?.confidence ?? 0
      const secondConfidence = fastResult.candidates[1]?.confidence ?? 0
      const shouldEscalate = topConfidence < 0.75 || (fastResult.candidates.length >= 2 && (topConfidence - secondConfidence) < 0.15)

      const result: BirdIdResult = shouldEscalate
        ? await (async () => {
          setProcessingMessage(
            `Photo ${photoIdx + 1}/${clusterPhotos.length}: Re-analyzing with enhanced model...`
          )
          setPhotoProgressTauMs(4400)
          setPhotoProgressRunKey(prev => prev + 1)
          return identifyBirdInPhoto(
            analyzeUrl,
            useGeoContext ? photo.gps : undefined,
            useGeoContext && photo.exifTime
              ? new Date(photo.exifTime).getMonth()
              : undefined,
            resolveInferenceLocationName(
              useGeoContext,
              lastLocationName,
              locationNameOverride,
            ),
            'strong'
          )
        })()
        : fastResult

      console.log(`✅ Found ${result.candidates.length} candidates`)
      setPhotoProgress(100)
      await wait(240)

      // Store AI crop box on the photo if we got one
      if (result.cropBox) {
        setPhotos(prev =>
          prev.map(p =>
            p.id === photo.id ? { ...p, aiCropBox: result.cropBox } : p
          )
        )
      }

      if (result.candidates.length === 0 && !imageUrl) {
        // No species found on full image, ask user to crop and retry
        console.log('No species identified, asking user to crop or skip')
        setStep('photo-manual-crop')
      } else if (result.multipleBirds && !imageUrl) {
        // Multiple birds detected, let user crop to the one they want
        console.log('Multiple birds detected, asking user to crop')
        toast.info('Multiple birds detected, crop to one')
        setCurrentCandidates(result.candidates)
        setStep('photo-manual-crop')
      } else {
        setCurrentCandidates(result.candidates)
        setProcessingMessage(
          `Photo ${photoIdx + 1}/${clusterPhotos.length}: Loading reference image...`
        )
        await prefetchWikiReference(result.candidates[0]?.species)
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
      void runSpeciesId(nextIdx)
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
    const existingSpecies = new Set(data.dex.map(entry => entry.speciesName))

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

    let hasNewSpecies = false
    let liferMessage = ''

    if (observations.length > 0) {
      data.addObservations(observations)
      const { newSpeciesCount } = data.updateDex(currentOutingId, observations)
      const newSpeciesNames = observations
        .map(obs => obs.speciesName)
        .filter(species => !existingSpecies.has(species))

      if (newSpeciesCount > 0) {
        hasNewSpecies = true
        const preview = newSpeciesNames
          .slice(0, 3)
          .map(name => getDisplayName(name))
          .join(', ')
        const suffix = newSpeciesNames.length > 3
          ? ` +${newSpeciesNames.length - 3} more`
          : ''
        liferMessage = '\uD83C\uDF89 ' + preview + suffix + ' added to your WingDex'
      }
    } else {
      toast.warning('No species were confirmed for this outing')
    }

    if (confirmed.length > 0) {
      const outingName = data.outings.find(outing => outing.id === currentOutingId)?.locationName || 'Outing'
      const speciesPreview = Array.from(new Set(confirmed.map(result => getDisplayName(result.species))))
        .slice(0, 3)
        .join(', ')
      const uniqueCount = new Set(confirmed.map(r => r.species)).size
      toast.success(`Saved ${uniqueCount} species to ${outingName}${speciesPreview ? `: ${speciesPreview}` : ''}.`, { duration: 6000 })
    }

    if (hasNewSpecies) {
      toast(liferMessage, { duration: 6000 })
    }

    if (currentClusterIndex < clusters.length - 1) {
      setCurrentClusterIndex(prev => prev + 1)
      setCurrentPhotoIndex(0)
      setPhotoResults([])
      setCurrentCandidates([])
      setStep('review')
      return
    }

    if (hasNewSpecies) {
      setShowConfetti(true)
      // Delay close so confetti canvas stays mounted
      window.sessionStorage.setItem('home:highlightOutingId', currentOutingId)
      window.dispatchEvent(new Event('home:highlightOuting'))
      setTimeout(() => onClose(), 1500)
    } else {
      window.sessionStorage.setItem('home:highlightOutingId', currentOutingId)
      window.dispatchEvent(new Event('home:highlightOuting'))
      onClose()
    }
  }

  // ─── File selection handler ──────────────────────────────
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    setStep('extracting')
    setProgress(0)
    setProcessingMessage('Reading photo data...')

    const newPhotos: PhotoWithCrop[] = []
    const duplicatePhotos: PhotoWithCrop[] = []

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

        const reader = new FileReader()
        const dataUrl = await new Promise<string>(resolve => {
          reader.onload = () => resolve(reader.result as string)
          reader.readAsDataURL(file)
        })

        const photo: PhotoWithCrop = {
          id: `photo_${Date.now()}_${i}`,
          outingId: '',
          dataUrl,
          thumbnail,
          // Store offset-aware ISO when GPS is available so clustering and
          // outing matching compare correct UTC instants regardless of browser TZ.
          // Falls back to naive EXIF time (browser-local) when no GPS.
          exifTime: exif.timestamp
            ? (exif.gps
                ? toLocalISOWithOffset(exif.timestamp, exif.gps.lat, exif.gps.lon)
                : exif.timestamp)
            : undefined,
          gps: exif.gps,
          fileHash: hash,
          fileName: file.name
        }

        const existing = data.photos.find(
          p => p.fileHash === hash && p.exifTime === photo.exifTime
        )
        if (existing) {
          duplicatePhotos.push(photo)
        } else {
          newPhotos.push(photo)
        }
      } catch (error) {
        console.error(`Failed to process ${file.name}:`, error)
        toast.error(`Failed to process ${file.name}`)
      }
      setProgress(((i + 1) / files.length) * 100)
    }

    if (newPhotos.length === 0 && duplicatePhotos.length === 0) {
      toast.error('No photos to process')
      onClose()
      return
    }

    if (duplicatePhotos.length > 0) {
      setPendingNewPhotos(newPhotos)
      setPendingDuplicatePhotos(duplicatePhotos)
      setShowDuplicateConfirm(true)
      return
    }

    setPhotos(newPhotos)
    setStep('review')
  }

  const handleDuplicateChoice = (reimport: boolean) => {
    setShowDuplicateConfirm(false)
    const finalPhotos = reimport
      ? [...pendingNewPhotos, ...pendingDuplicatePhotos]
      : pendingNewPhotos

    setPendingNewPhotos([])
    setPendingDuplicatePhotos([])

    if (finalPhotos.length === 0) {
      toast.warning(
        pendingDuplicatePhotos.length === 1
          ? 'This photo was already imported'
          : `All ${pendingDuplicatePhotos.length} photos were already imported`
      )
      onClose()
      return
    }

    if (!reimport && pendingDuplicatePhotos.length > 0) {
      toast.info(
        `${pendingDuplicatePhotos.length} duplicate ${pendingDuplicatePhotos.length === 1 ? 'photo' : 'photos'} skipped`
      )
    }

    setPhotos(finalPhotos)
    setStep('review')
  }

  // ─── Outing confirmed → start per-photo loop ────────────
  const handleOutingConfirmed = async (
    outingId: string,
    locationName: string
  ) => {
    const normalizedLocationName = normalizeLocationName(locationName)
    setLastLocationName(normalizedLocationName)
    setCurrentOutingId(outingId)

    const cluster = clusters[currentClusterIndex]
    const updatedPhotos = cluster.photos.map((p: any) => {
      const fullPhoto = photos.find(fp => fp.id === p.id)
      return { ...fullPhoto, outingId }
    })
    // Persist only metadata, strip large base64 blobs to avoid KV/localStorage overflow
    const photosForStorage = updatedPhotos.map((p: any) => ({
      id: p.id,
      outingId: p.outingId,
      dataUrl: '',      // ephemeral, not persisted
      thumbnail: '',    // ephemeral, not persisted
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
    runSpeciesId(0, undefined, normalizedLocationName)
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
        return `Identifying photo ${currentPhotoIndex + 1} of ${clusterPhotos.length}...`
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
      <Confetti active={showConfetti} />
      <AlertDialog open={showDuplicateConfirm} onOpenChange={setShowDuplicateConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Duplicate photos found</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingNewPhotos.length > 0
                ? `${pendingDuplicatePhotos.length} of ${pendingDuplicatePhotos.length + pendingNewPhotos.length} ${pendingDuplicatePhotos.length + pendingNewPhotos.length === 1 ? 'photo has' : 'photos have'} already been imported. Re-importing will add duplicate sightings and increase species counts.`
                : pendingDuplicatePhotos.length === 1
                  ? 'This photo has already been imported. Re-importing it will add a duplicate sighting and increase species counts.'
                  : `All ${pendingDuplicatePhotos.length} photos have already been imported. Re-importing them will add duplicate sightings and increase species counts.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => handleDuplicateChoice(false)}>
              {pendingNewPhotos.length > 0 ? 'Skip duplicates' : 'Cancel'}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => handleDuplicateChoice(true)}>
              Re-import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                    Bird photos only. Used for ID and not retained; we store a file hash for duplicate detection.
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
                <div className="flex flex-col items-center gap-1">
                  <div className="w-full max-w-48 aspect-square rounded-lg border-2 border-border overflow-hidden bg-muted/20">
                    <img
                      src={fullCurrentPhoto.croppedDataUrl || fullCurrentPhoto.thumbnail}
                      alt="Current photo"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              )}
              <Progress value={photoProgress} className="w-full" />
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
    </>
  )
}

// ────────────────────────────────────────────────────────────
//  AI Zoomed preview, renders the crop box region onto a canvas
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
      const paddedSquare = computePaddedSquareCropFromPercent(cropBox, img.naturalWidth, img.naturalHeight)
      const rawSx = paddedSquare.x
      const rawSy = paddedSquare.y
      const rawSw = paddedSquare.width
      const rawSh = paddedSquare.height
      // Defensive clamp in case AI crop values are slightly out of range
      const sx = Math.max(0, Math.min(rawSx, img.naturalWidth - 1))
      const sy = Math.max(0, Math.min(rawSy, img.naturalHeight - 1))
      const sw = Math.max(1, Math.min(rawSw, img.naturalWidth - sx))
      const sh = Math.max(1, Math.min(rawSh, img.naturalHeight - sy))
      // Render at a reasonable resolution for the square container
      const OUTPUT_DIM = 384
      canvas.width = OUTPUT_DIM
      canvas.height = OUTPUT_DIM
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OUTPUT_DIM, OUTPUT_DIM)
    }
    img.src = imageUrl
  }, [imageUrl, cropBox])

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full object-cover"
    />
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
  const topCandidate = candidates[0]
  const [showAlternatives, setShowAlternatives] = useState(false)
  const [selectedSpecies, setSelectedSpecies] = useState(topCandidate?.species ?? '')
  const [selectedConfidence, setSelectedConfidence] = useState(topCandidate?.confidence ?? 0)
  const isHighConfidence = selectedConfidence >= 0.8
  
  // Fetch Wikipedia reference image for the selected species
  const { imageUrl: wikiImage, loading: wikiLoading } = useBirdImageWithStatus(selectedSpecies)

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
    onConfirm(selectedSpecies, selectedConfidence, status, 1)
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
      {/* Photo, zoomed to bird if AI crop box available */}
      <div className="flex justify-center gap-3 items-start">
        <div className="flex flex-col items-center gap-1" style={{ flex: '1 1 0', minWidth: 0, maxWidth: '50%' }}>
          <div className="w-full max-w-48 aspect-square rounded-lg border-2 border-border overflow-hidden bg-muted/20">
            {aiCropBox && !photo.croppedDataUrl ? (
              <AiZoomedPreview
                imageUrl={photo.dataUrl || photo.thumbnail}
                cropBox={aiCropBox}
              />
            ) : (
              <img
                src={displayImage}
                alt="Your photo"
                className="w-full h-full object-cover"
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {photo.croppedDataUrl || aiCropBox ? 'Your photo (cropped)' : 'Your photo'}
          </p>
        </div>
        
        {/* Wikipedia reference image */}
        <div className="flex flex-col items-center gap-1" style={{ flex: '1 1 0', minWidth: 0, maxWidth: '50%' }}>
          <WikiBirdThumbnail
            speciesName={selectedSpecies}
            imageUrl={wikiImage}
            alt={`${displayName} reference`}
            className="w-full max-w-48 border-2 border-muted"
            loading={wikiLoading}
          />
          <p className="text-xs text-muted-foreground">Wikipedia reference</p>
        </div>
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
          <span
            className={`font-serif text-3xl font-semibold tabular-nums leading-none ${
              confidencePct >= 80
                ? 'text-green-600 dark:text-green-400'
                : confidencePct >= 50
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-red-500 dark:text-red-400'
            }`}
          >
            {confidencePct}%
          </span>
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
          /* HIGH CONFIDENCE, auto-selected, alternatives hidden */
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
              <CheckCircle size={16} weight="fill" />
              <span>High confidence, auto-selected</span>
            </div>

            <div className="flex gap-2">
              <Button
                className="flex-1"
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
              <Button className="flex-1" onClick={() => handleConfirm('confirmed')}>
                <CheckCircle size={16} className="mr-1" weight="bold" />
                Confirm
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => handleConfirm('possible')}
              >
                <Question size={16} className="mr-1" weight="bold" />
                Possible
              </Button>
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
