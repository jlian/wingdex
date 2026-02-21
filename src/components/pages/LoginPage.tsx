import { useState } from 'react'
import { Bird, Key } from '@phosphor-icons/react'

import { authClient } from '@/lib/auth-client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import PasskeyAuthDialog from '@/components/flows/PasskeyAuthDialog'

interface LoginPageProps {
  onAuthenticated: () => void
}

export default function LoginPage({ onAuthenticated }: LoginPageProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)

  const handleSignIn = async () => {
    setSignInError(null)
    setSigningIn(true)

    const result = await authClient.signIn.passkey({ autoFill: false })

    if (result.error) {
      setSigningIn(false)
      setSignInError(result.error.message || 'Passkey sign-in failed.')
      return
    }

    // Verify it's a real (non-anonymous) session
    const sessionResult = await authClient.getSession()
    const isAnonymous = Boolean(
      (sessionResult.data?.user as { isAnonymous?: boolean } | undefined)?.isAnonymous,
    )
    if (isAnonymous || !sessionResult.data?.user) {
      await authClient.signOut()
      setSigningIn(false)
      setSignInError('No passkey found. Create a new account instead.')
      return
    }

    setSigningIn(false)
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
            <h1 className="text-lg font-semibold text-foreground">Welcome to WingDex</h1>
            <p className="text-sm text-muted-foreground">
              Your personal bird-watching companion. Sign in or create an account to get started.
            </p>
          </div>

          <Button className="w-full" onClick={() => setDialogOpen(true)} disabled={signingIn}>
            <Key size={18} className="mr-2" />
            Continue with passkey
          </Button>

          {signInError && <p className="text-sm text-destructive">{signInError}</p>}

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <button
              className="text-primary underline-offset-4 hover:underline cursor-pointer"
              onClick={handleSignIn}
              disabled={signingIn}
            >
              {signingIn ? 'Signing in…' : 'Sign in'}
            </button>
          </p>
        </Card>
      </div>

      <PasskeyAuthDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onAuthenticated={onAuthenticated}
      />
    </div>
  )
}
