import { useState } from 'react'
import { Bird, Key, PlusCircle } from '@phosphor-icons/react'

import { authClient } from '@/lib/auth-client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface LoginPageProps {
  onAuthenticated: () => void
}

export default function LoginPage({ onAuthenticated }: LoginPageProps) {
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleSignInPasskey = async () => {
    setErrorMessage(null)
    setIsSigningIn(true)

    const result = await authClient.signIn.passkey({ autoFill: false })

    setIsSigningIn(false)
    if (result.error) {
      setErrorMessage(result.error.message || 'Passkey sign-in failed. Please try again.')
      return
    }

    onAuthenticated()
  }

  const handleCreateWithPasskey = async () => {
    setErrorMessage(null)
    setIsCreating(true)

    const anonymousResult = await authClient.signIn.anonymous()
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
      setErrorMessage(passkeyResult.error.message || 'Passkey registration failed. Please try again.')
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
