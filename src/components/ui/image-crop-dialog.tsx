import { useState, useRef, useEffect, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Crop, Check, X } from '@phosphor-icons/react'
import { computeRenderedImageRect, computePointerPosition } from '@/lib/crop-math'

interface ImageCropDialogProps {
  imageUrl: string
  onCrop: (croppedImageUrl: string) => void
  onCancel: () => void
  open: boolean
  /** Optional initial crop position as percentage coordinates (0-100) from AI */
  initialCropBox?: { x: number; y: number; width: number; height: number }
}

/** Compute the rendered image rect inside a container using object-contain logic */
function getRenderedImageRect(img: HTMLImageElement, container: HTMLDivElement) {
  const containerRect = container.getBoundingClientRect()
  const cW = containerRect.width
  const cH = containerRect.height
  const iW = img.naturalWidth
  const iH = img.naturalHeight
  if (!iW || !iH || !cW || !cH) return null

  const info = computeRenderedImageRect(cW, cH, iW, iH)
  return { ...info, containerRect }
}

export default function ImageCropDialog({ imageUrl, onCrop, onCancel, open, initialCropBox }: ImageCropDialogProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0, width: 100, height: 100 })
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const initCrop = useCallback(() => {
    const img = imageRef.current
    if (!img || !img.naturalWidth) return
    if (initialCropBox) {
      const pad = 0.1
      const rawX = (initialCropBox.x / 100) * img.naturalWidth
      const rawY = (initialCropBox.y / 100) * img.naturalHeight
      const rawW = (initialCropBox.width / 100) * img.naturalWidth
      const rawH = (initialCropBox.height / 100) * img.naturalHeight
      const padX = rawW * pad
      const padY = rawH * pad
      const cropSize = Math.max(rawW + padX * 2, rawH + padY * 2)
      const centerX = rawX + rawW / 2
      const centerY = rawY + rawH / 2
      setCrop({
        x: Math.max(0, Math.min(centerX - cropSize / 2, img.naturalWidth - cropSize)),
        y: Math.max(0, Math.min(centerY - cropSize / 2, img.naturalHeight - cropSize)),
        width: Math.min(cropSize, img.naturalWidth),
        height: Math.min(cropSize, img.naturalHeight),
      })
    } else {
      const minDim = Math.min(img.naturalWidth, img.naturalHeight)
      const cropSize = minDim * 0.6
      setCrop({
        x: (img.naturalWidth - cropSize) / 2,
        y: (img.naturalHeight - cropSize) / 2,
        width: cropSize,
        height: cropSize
      })
    }
  }, [initialCropBox])

  useEffect(() => {
    if (open) {
      setImageLoaded(false)
    }
  }, [open, imageUrl])

  const handleImageLoad = useCallback(() => {
    setImageLoaded(true)
    initCrop()
  }, [initCrop])

  /** Convert screen coords to image-space coords, accounting for object-contain letterboxing */
  const getPointerPosition = (clientX: number, clientY: number) => {
    if (!imageRef.current || !containerRef.current) return null
    const rect = containerRef.current.getBoundingClientRect()
    const natW = imageRef.current.naturalWidth
    const natH = imageRef.current.naturalHeight
    if (!natW || !natH || !rect.width || !rect.height) return null

    return computePointerPosition(clientX, clientY, rect, natW, natH)
  }

  const startDrag = (clientX: number, clientY: number) => {
    const pos = getPointerPosition(clientX, clientY)
    if (!pos) return
    if (
      pos.x >= crop.x &&
      pos.x <= crop.x + crop.width &&
      pos.y >= crop.y &&
      pos.y <= crop.y + crop.height
    ) {
      setDragStart({ x: pos.x - crop.x, y: pos.y - crop.y })
      setIsDragging(true)
    }
  }

  const moveDrag = (clientX: number, clientY: number) => {
    if (!isDragging || !dragStart || !imageRef.current) return
    const pos = getPointerPosition(clientX, clientY)
    if (!pos) return
    const x = Math.max(0, Math.min(pos.x - dragStart.x, imageRef.current.naturalWidth - crop.width))
    const y = Math.max(0, Math.min(pos.y - dragStart.y, imageRef.current.naturalHeight - crop.height))
    setCrop(prev => ({ ...prev, x, y }))
  }

  const endDrag = () => {
    setIsDragging(false)
    setDragStart(null)
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    startDrag(e.clientX, e.clientY)
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    moveDrag(e.clientX, e.clientY)
  }

  const handleMouseUp = () => {
    endDrag()
  }

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return
    const touch = e.touches[0]
    startDrag(touch.clientX, touch.clientY)
  }

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return
    if (isDragging) e.preventDefault()
    const touch = e.touches[0]
    moveDrag(touch.clientX, touch.clientY)
  }

  const handleTouchEnd = () => {
    endDrag()
  }

  const handleCrop = async () => {
    if (!canvasRef.current || !imageRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = crop.width
    canvas.height = crop.height

    ctx.drawImage(
      imageRef.current,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height
    )

    const croppedImageUrl = canvas.toDataURL('image/jpeg', 0.9)
    onCrop(croppedImageUrl)
  }

  const handleResize = (delta: number) => {
    if (!imageRef.current) return
    const newWidth = Math.max(50, Math.min(crop.width + delta, imageRef.current.naturalWidth))
    const newHeight = Math.max(50, Math.min(crop.height + delta, imageRef.current.naturalHeight))
    const centerX = crop.x + crop.width / 2
    const centerY = crop.y + crop.height / 2
    setCrop({
      x: Math.max(0, Math.min(centerX - newWidth / 2, imageRef.current.naturalWidth - newWidth)),
      y: Math.max(0, Math.min(centerY - newHeight / 2, imageRef.current.naturalHeight - newHeight)),
      width: newWidth,
      height: newHeight
    })
  }

  return (
    <Dialog open={open} onOpenChange={onCancel}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl flex items-center gap-2">
            <Crop size={24} /> Crop Bird Photo
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden min-h-[200px]">
          <div
            ref={containerRef}
            className="relative w-full h-full cursor-move touch-none"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
          >
            <img
              ref={imageRef}
              src={imageUrl}
              alt="Crop preview"
              className="w-full h-full object-contain"
              draggable={false}
              onLoad={handleImageLoad}
            />
            {imageLoaded && imageRef.current && containerRef.current && (() => {
              const info = getRenderedImageRect(imageRef.current!, containerRef.current!)
              if (!info) return null
              const { offsetX, offsetY, renderedW, renderedH } = info
              const natW = imageRef.current!.naturalWidth
              const natH = imageRef.current!.naturalHeight
              return (
                <div
                  className="absolute border-2 border-accent shadow-lg pointer-events-none"
                  style={{
                    left: `${offsetX + (crop.x / natW) * renderedW}px`,
                    top: `${offsetY + (crop.y / natH) * renderedH}px`,
                    width: `${(crop.width / natW) * renderedW}px`,
                    height: `${(crop.height / natH) * renderedH}px`,
                    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)'
                  }}
                >
                  <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
                    {Array.from({ length: 9 }).map((_, i) => (
                      <div key={i} className="border border-accent/30" />
                    ))}
                  </div>
                </div>
              )
            })()}
          </div>
        </div>

        <div className="space-y-3 pt-4">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground min-w-20">Crop Size:</span>
            <Slider
              value={[crop.width]}
              onValueChange={([value]) => {
                if (!imageRef.current) return
                const delta = value - crop.width
                handleResize(delta)
              }}
              min={50}
              max={imageRef.current?.naturalWidth || 1000}
              step={10}
              className="flex-1"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Drag the crop area to position it, or use the slider to adjust size
          </p>
        </div>

        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={onCancel}>
            <X size={18} className="mr-2" /> Cancel
          </Button>
          <Button onClick={handleCrop} className="bg-accent text-accent-foreground">
            <Check size={18} className="mr-2" weight="bold" /> Apply Crop
          </Button>
        </DialogFooter>

        <canvas ref={canvasRef} className="hidden" />
      </DialogContent>
    </Dialog>
  )
}
