import { useState } from 'react'
import { Bird, Key, PlusCircle } from '@phosphor-icons/react'

import { authClient } from '@/lib/auth-client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface LoginPageProps {
  onAuthenticated: () => void
}

export default function LoginPage({ onAuthenticated }: LoginPageProps) {
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')

  const handleSignInPasskey = async () => {
    setErrorMessage(null)
    setIsSigningIn(true)

    const result = await authClient.signIn.passkey({ autoFill: false })

    setIsSigningIn(false)
    if (result.error) {
      setErrorMessage(result.error.message || 'Passkey sign-in failed. Please try again.')
      return
    }

    const sessionResult = await authClient.getSession()
    const isAnonymousSession = Boolean((sessionResult.data?.user as { isAnonymous?: boolean } | undefined)?.isAnonymous)
    if (isAnonymousSession || !sessionResult.data?.user) {
      await authClient.signOut()
      setErrorMessage('No passkey was completed. Please create an account with passkey or retry sign-in.')
      return
    }

    onAuthenticated()
  }

  const handleCreateWithPasskey = async () => {
    const trimmedName = displayName.trim()
    if (!trimmedName) {
      setErrorMessage('Please enter a display name before creating a passkey account.')
      return
    }

    setErrorMessage(null)
    setIsCreating(true)

    const anonymousResult = await authClient.signIn.anonymous({
      fetchOptions: {
        headers: {
          'x-wingdex-passkey-signup': '1',
        },
      },
    })
    if (anonymousResult.error) {
      setIsCreating(false)
      setErrorMessage(anonymousResult.error.message || 'Unable to create account session.')
      return
    }

    const passkeyResult = await authClient.passkey.addPasskey({
      name: 'WingDex passkey',
      authenticatorAttachment: 'platform',
    })

    setIsCreating(false)
    if (passkeyResult.error) {
      await authClient.signOut()
      setErrorMessage(passkeyResult.error.message || 'Passkey registration failed. Please try again.')
      return
    }

    const finalizeResponse = await fetch('/api/auth/finalize-passkey', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmedName }),
    })

    if (!finalizeResponse.ok) {
      await authClient.signOut()
      setErrorMessage('Account setup could not be completed. Please try again.')
      return
    }

    onAuthenticated()
  }

  return (
    <div className="min-h-screen bg-background px-4">
      <div className="mx-auto max-w-md py-16 space-y-4">
        <Card className="p-6 space-y-5">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 text-primary">
              <Bird size={20} weight="duotone" />
              <span className="font-semibold">WingDex</span>
            </div>
            <h1 className="text-lg font-semibold text-foreground">Sign in with passkey</h1>
            <p className="text-sm text-muted-foreground">
              Use your existing passkey, or create a new account with passkey in one step.
            </p>
          </div>

          <div className="space-y-2">
            <Button className="w-full" onClick={handleSignInPasskey} disabled={isSigningIn || isCreating}>
              <Key size={18} className="mr-2" />
              {isSigningIn ? 'Signing in...' : 'Sign in with passkey'}
            </Button>

            <Input
              value={displayName}
              onChange={event => setDisplayName(event.target.value)}
              placeholder="Display name"
              aria-label="Display name"
              disabled={isSigningIn || isCreating}
            />

            <Button variant="outline" className="w-full" onClick={handleCreateWithPasskey} disabled={isSigningIn || isCreating}>
              <PlusCircle size={18} className="mr-2" />
              {isCreating ? 'Creating account...' : 'Create account with passkey'}
            </Button>
          </div>

          {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
        </Card>
      </div>
    </div>
  )
}
