import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Flask } from '@phosphor-icons/react'
import { toast } from 'sonner'
import birdTestImage from '@/assets/images/bird-test.jpeg'

interface TestHelperProps {
  onTestPhotoReady: (file: File) => void
}

export default function TestHelper({ onTestPhotoReady }: TestHelperProps) {
  const handleLoadTestImage = async () => {
    try {
      toast.info('Loading test image: Kingfisher from Taiwan...')
      
      const response = await fetch(birdTestImage)
      const blob = await response.blob()
      
      const file = new File([blob], 'bird-test.jpeg', { type: 'image/jpeg' })
      
      toast.success('Test image loaded! Opening upload flow...')
      onTestPhotoReady(file)
    } catch (error) {
      console.error('Failed to load test image:', error)
      toast.error('Failed to load test image')
    }
  }

  return (
    <Card className="p-4 bg-accent/10 border-accent/30">
      <div className="flex items-center gap-3">
        <Flask size={24} className="text-accent" weight="duotone" />
        <div className="flex-1">
          <h3 className="font-semibold text-sm">Developer Test Mode</h3>
          <p className="text-xs text-muted-foreground">
            Test AI inference with pre-loaded Kingfisher image
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleLoadTestImage}
          className="border-accent text-accent hover:bg-accent hover:text-accent-foreground"
        >
          Load Test Image
        </Button>
      </div>
    </Card>
  )
}
