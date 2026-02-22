import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowsClockwise, Bird, GithubLogo, Key, UserPlus, AppleLogo } from '@phosphor-icons/react'

import { authClient } from '@/lib/auth-client'
import { generateBirdName } from '@/lib/fun-names'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface LoginPageProps {
  onAuthenticated: () => void
}

export default function LoginPage({ onAuthenticated }: LoginPageProps) {
  const [view, setView] = useState<'welcome' | 'signup'>('welcome')
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState(() => generateBirdName())
  const [providers, setProviders] = useState<string[]>([])

  useEffect(() => {
    void fetch('/api/auth/providers').then(r => r.ok ? r.json() : null).then(
      (data: { providers: string[] } | null) => { if (data) setProviders(data.providers) },
    )
  }, [])

  const rerollName = () => setDisplayName(generateBirdName())

  const handlePasskeySignIn = async () => {
    setErrorMessage(null)
    setIsLoading(true)

    const result = await authClient.signIn.passkey({ autoFill: false })

    if (result.error) {
      setIsLoading(false)
      setErrorMessage(result.error.message || 'Passkey sign-in failed.')
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
      return
    }

    setIsLoading(false)
    onAuthenticated()
  }

  const handleGitHubSignIn = () => {
    setErrorMessage(null)
    void authClient.signIn.social({ provider: 'github' })
  }

  const handleAppleSignIn = () => {
    setErrorMessage(null)
    void authClient.signIn.social({ provider: 'apple' })
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
    <div className="min-h-screen bg-background px-4">
      <div className="mx-auto max-w-md py-16 space-y-4">
        <Card className="p-6 space-y-5">
          {view === 'welcome' ? (
            <>
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

              <div className="space-y-2">
                <Button
                  className="w-full"
                  onClick={() => { setErrorMessage(null); setView('signup') }}
                  disabled={isLoading}
                >
                  <Key size={18} className="mr-2" />
                  Continue with passkey
                </Button>

                {providers.includes('github') && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={handleGitHubSignIn}
                    disabled={isLoading}
                  >
                    <GithubLogo size={18} className="mr-2" />
                    Sign in with GitHub
                  </Button>
                )}

                {providers.includes('apple') && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={handleAppleSignIn}
                    disabled={isLoading}
                  >
                    <AppleLogo size={18} className="mr-2" />
                    Sign in with Apple
                  </Button>
                )}
              </div>

              {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}

              <p className="text-center text-sm text-muted-foreground">
                Already have a passkey?{' '}
                <button
                  className="text-primary underline-offset-4 hover:underline cursor-pointer"
                  onClick={handlePasskeySignIn}
                  disabled={isLoading}
                >
                  {isLoading ? 'Signing in…' : 'Sign in'}
                </button>
              </p>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <button
                  className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground cursor-pointer"
                  onClick={() => { setErrorMessage(null); setView('welcome') }}
                  disabled={isLoading}
                >
                  <ArrowLeft size={14} />
                  Back
                </button>
                <h1 className="text-lg font-semibold text-foreground">Create your account</h1>
                <p className="text-sm text-muted-foreground">
                  Pick a display name and register a passkey to get started.
                </p>
              </div>

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
                Already have a passkey?{' '}
                <button
                  className="text-primary underline-offset-4 hover:underline cursor-pointer"
                  onClick={handlePasskeySignIn}
                  disabled={isLoading}
                >
                  {isLoading ? 'Signing in…' : 'Sign in'}
                </button>
              </p>
            </>
          )}
        </Card>
      </div>
    </div>
  )
}
