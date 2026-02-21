import { useState } from 'react'
import { ArrowsClockwise, Key, UserPlus } from '@phosphor-icons/react'

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

export default function PasskeyAuthDialog({ open, onOpenChange, onAuthenticated }: PasskeyAuthDialogProps) {
  const [view, setView] = useState<'signup' | 'signin'>('signup')
  const [displayName, setDisplayName] = useState(() => generateBirdName())
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const rerollName = () => setDisplayName(generateBirdName())

  const handleSignIn = async () => {
    setErrorMessage(null)
    setIsLoading(true)

    const result = await authClient.signIn.passkey({ autoFill: false })

    if (result.error) {
      setIsLoading(false)
      setErrorMessage(result.error.message || 'Passkey sign-in failed. Please try again.')
      return
    }

    // Verify it's a real (non-anonymous) session
    const sessionResult = await authClient.getSession()
    const isAnonymous = Boolean(
      (sessionResult.data?.user as { isAnonymous?: boolean } | undefined)?.isAnonymous,
    )
    if (isAnonymous || !sessionResult.data?.user) {
      await authClient.signOut()
      setIsLoading(false)
      setErrorMessage('No passkey found. Create a new account instead.')
      setView('signup')
      return
    }

    setIsLoading(false)
    onAuthenticated()
  }

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

    setIsLoading(false)
    onAuthenticated()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {view === 'signup' ? (
          <>
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

            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{' '}
              <button
                className="text-primary underline-offset-4 hover:underline cursor-pointer"
                onClick={() => { setErrorMessage(null); setView('signin') }}
                disabled={isLoading}
              >
                Sign in
              </button>
            </p>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Sign in</DialogTitle>
              <DialogDescription>
                Use your existing passkey to sign in.
              </DialogDescription>
            </DialogHeader>

            <Button className="w-full" onClick={handleSignIn} disabled={isLoading}>
              <Key size={18} className="mr-2" />
              {isLoading ? 'Signing in…' : 'Sign in with passkey'}
            </Button>

            {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}

            <p className="text-center text-sm text-muted-foreground">
              New here?{' '}
              <button
                className="text-primary underline-offset-4 hover:underline cursor-pointer"
                onClick={() => { setErrorMessage(null); setView('signup') }}
                disabled={isLoading}
              >
                Create account
              </button>
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
