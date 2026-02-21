import { useState } from 'react'
import { ArrowsClockwise, UserPlus } from '@phosphor-icons/react'

import { authClient } from '@/lib/auth-client'
import { generateBirdName } from '@/lib/fun-names'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface PasskeyAuthDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAuthenticated: () => void
}

/** Dialog close animation is 200ms — wait for it before unmounting. */
const CLOSE_ANIMATION_MS = 220

export default function PasskeyAuthDialog({ open, onOpenChange, onAuthenticated }: PasskeyAuthDialogProps) {
  const [displayName, setDisplayName] = useState(() => generateBirdName())
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const rerollName = () => setDisplayName(generateBirdName())

  const handleCreateAccount = async () => {
    const trimmedName = displayName.trim()
    if (!trimmedName) {
      setErrorMessage('Please enter a display name.')
      return
    }

    setErrorMessage(null)
    setIsLoading(true)

    // Step 1: anonymous bootstrap (gated by middleware header)
    const anonResult = await authClient.signIn.anonymous({
      fetchOptions: {
        headers: { 'x-wingdex-passkey-signup': '1' },
      },
    })
    if (anonResult.error) {
      setIsLoading(false)
      setErrorMessage(anonResult.error.message || 'Unable to start account creation.')
      return
    }

    // Step 2: register passkey on the anonymous session
    const passkeyResult = await authClient.passkey.addPasskey({
      name: 'WingDex passkey',
      authenticatorAttachment: 'platform',
    })
    if (passkeyResult.error) {
      await authClient.signOut()
      setIsLoading(false)
      setErrorMessage(passkeyResult.error.message || 'Passkey registration failed. Please try again.')
      return
    }

    // Step 3: finalize — flip anonymous → real user
    const finalizeResponse = await fetch('/api/auth/finalize-passkey', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmedName }),
    })
    if (!finalizeResponse.ok) {
      await authClient.signOut()
      setIsLoading(false)
      setErrorMessage('Account setup could not be completed. Please try again.')
      return
    }

    // Close the dialog and let the animation finish before transitioning
    setIsLoading(false)
    onOpenChange(false)
    setTimeout(onAuthenticated, CLOSE_ANIMATION_MS)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create your account</DialogTitle>
          <DialogDescription>
            Pick a display name and register a passkey to get started.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Display name"
              aria-label="Display name"
              disabled={isLoading}
              className="flex-1"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={rerollName}
              disabled={isLoading}
              aria-label="Randomize name"
              title="Randomize name"
            >
              <ArrowsClockwise size={16} />
            </Button>
          </div>

          <Button className="w-full" onClick={handleCreateAccount} disabled={isLoading}>
            <UserPlus size={18} className="mr-2" />
            {isLoading ? 'Creating account…' : 'Create account'}
          </Button>
        </div>

        {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
      </DialogContent>
    </Dialog>
  )
}
