import { useState, useRef, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Crop, Check, X } from '@phosphor-icons/react'

interface ImageCropDialogProps {
  imageUrl: string
  onCrop: (croppedImageUrl: string) => void
  onCancel: () => void
  open: boolean
}

export default function ImageCropDialog({ imageUrl, onCrop, onCancel, open }: ImageCropDialogProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0, width: 100, height: 100 })
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [scale, setScale] = useState(1)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open && imageRef.current) {
      const img = imageRef.current
      const minDim = Math.min(img.naturalWidth, img.naturalHeight)
      const cropSize = minDim * 0.6
      setCrop({
        x: (img.naturalWidth - cropSize) / 2,
        y: (img.naturalHeight - cropSize) / 2,
        width: cropSize,
        height: cropSize
      })
    }
  }, [open, imageUrl])

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!imageRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const scaleX = imageRef.current.naturalWidth / rect.width
    const scaleY = imageRef.current.naturalHeight / rect.height
    const x = (e.clientX - rect.left) * scaleX
    const y = (e.clientY - rect.top) * scaleY

    if (
      x >= crop.x &&
      x <= crop.x + crop.width &&
      y >= crop.y &&
      y <= crop.y + crop.height
    ) {
      setDragStart({ x: x - crop.x, y: y - crop.y })
      setIsDragging(true)
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging || !dragStart || !imageRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const scaleX = imageRef.current.naturalWidth / rect.width
    const scaleY = imageRef.current.naturalHeight / rect.height
    const x = Math.max(0, Math.min((e.clientX - rect.left) * scaleX - dragStart.x, imageRef.current.naturalWidth - crop.width))
    const y = Math.max(0, Math.min((e.clientY - rect.top) * scaleY - dragStart.y, imageRef.current.naturalHeight - crop.height))
    setCrop(prev => ({ ...prev, x, y }))
  }

  const handleMouseUp = () => {
    setIsDragging(false)
    setDragStart(null)
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

        <div className="flex-1 overflow-hidden">
          <div
            ref={containerRef}
            className="relative w-full h-full cursor-move"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <img
              ref={imageRef}
              src={imageUrl}
              alt="Crop preview"
              className="w-full h-full object-contain"
              draggable={false}
            />
            {imageRef.current && containerRef.current && (
              <div
                className="absolute border-2 border-accent shadow-lg pointer-events-none"
                style={{
                  left: `${(crop.x / imageRef.current.naturalWidth) * 100}%`,
                  top: `${(crop.y / imageRef.current.naturalHeight) * 100}%`,
                  width: `${(crop.width / imageRef.current.naturalWidth) * 100}%`,
                  height: `${(crop.height / imageRef.current.naturalHeight) * 100}%`,
                  boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)'
                }}
              >
                <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
                  {Array.from({ length: 9 }).map((_, i) => (
                    <div key={i} className="border border-accent/30" />
                  ))}
                </div>
              </div>
            )}
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
