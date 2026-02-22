import { useState, useCallback, useRef } from 'react'
import { Key, GithubLogo, AppleLogo } from '@phosphor-icons/react'

import { authClient } from '@/lib/auth-client'
import { generateBirdName } from '@/lib/fun-names'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** Safely extract error code from Better Auth error union */
function errCode(err: { code?: string; message?: string }): string | undefined {
  return 'code' in err ? err.code : undefined
}

interface AuthGateOptions {
  isAnonymous: boolean
  onUpgraded: () => void
}

/**
 * Hook that gates actions behind authentication.
 * Returns `requireAuth(callback)` — if user is anonymous, opens sign-up modal.
 * If user is already authenticated, runs the callback immediately.
 * Also returns `<AuthGateModal />` to render once in the tree.
 */
export function useAuthGate({ isAnonymous, onUpgraded }: AuthGateOptions) {
  const [open, setOpen] = useState(false)
  const pendingCallback = useRef<(() => void) | null>(null)

  const requireAuth = useCallback((callback: () => void) => {
    if (!isAnonymous) {
      callback()
      return
    }
    pendingCallback.current = callback
    setOpen(true)
  }, [isAnonymous])

  const openSignIn = useCallback(() => {
    pendingCallback.current = null
    setOpen(true)
  }, [])

  const handleUpgraded = useCallback(() => {
    setOpen(false)
    onUpgraded()
    // Run the pending action after a brief delay so session can refresh
    const cb = pendingCallback.current
    pendingCallback.current = null
    if (cb) setTimeout(cb, 100)
  }, [onUpgraded])

  const modal = (
    <AuthGateModal
      open={open}
      onOpenChange={setOpen}
      onUpgraded={handleUpgraded}
    />
  )

  return { requireAuth, openSignIn, AuthGateModal: modal }
}

// ─── Modal ──────────────────────────────────────────────

interface AuthGateModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpgraded: () => void
}

function AuthGateModal({ open, onOpenChange, onUpgraded }: AuthGateModalProps) {
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [providers, setProviders] = useState<string[] | null>(null)

  // Fetch providers on first open
  const fetchedProviders = useRef(false)
  if (open && !fetchedProviders.current) {
    fetchedProviders.current = true
    void fetch('/api/auth/providers').then(r => r.ok ? r.json() : null).then(
      (data: { providers: string[] } | null) => { if (data) setProviders(data.providers) },
    )
  }

  const handleContinueWithPasskey = async () => {
    setErrorMessage(null)
    setIsLoading(true)

    const trimmedEmail = email.trim().toLowerCase()

    // If email provided, check if account exists — route to sign-in
    if (trimmedEmail) {
      try {
        const checkRes = await fetch(`/api/auth/check-email?email=${encodeURIComponent(trimmedEmail)}`)
        if (checkRes.ok) {
          const { exists } = await checkRes.json() as { exists: boolean }
          if (exists) {
            // Account exists — sign in with passkey
            const signInResult = await authClient.signIn.passkey({ autoFill: false })
            if (signInResult.error) {
              setIsLoading(false)
              if (errCode(signInResult.error) === 'AUTH_CANCELLED') {
                setErrorMessage('Sign-in cancelled.')
              } else {
                setErrorMessage(signInResult.error.message || 'Sign-in failed.')
              }
              return
            }
            setIsLoading(false)
            onUpgraded()
            return
          }
        }
      } catch {
        // If check fails, proceed with registration
      }
    }

    // Create account: the current session is already anonymous, so just
    // register a passkey on it and finalize.
    const birdName = generateBirdName()
    const passkeyLabel = trimmedEmail || birdName

    const passkeyResult = await authClient.passkey.addPasskey({
      name: passkeyLabel,
      authenticatorAttachment: 'platform',
    })
    if (passkeyResult.error) {
      setIsLoading(false)
      if (errCode(passkeyResult.error) === 'ERROR_CEREMONY_ABORTED') {
        setErrorMessage('Passkey registration cancelled.')
      } else if (errCode(passkeyResult.error) === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
        setErrorMessage('This device already has a passkey registered. Try signing in instead.')
      } else {
        setErrorMessage(passkeyResult.error.message || 'Passkey registration failed.')
      }
      return
    }

    // Finalize — flip anonymous → real user
    const finalizeRes = await fetch('/api/auth/finalize-passkey', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: birdName,
        ...(trimmedEmail ? { email: trimmedEmail } : {}),
      }),
    })
    if (!finalizeRes.ok) {
      const data = await finalizeRes.json().catch(() => null) as { error?: string } | null
      setIsLoading(false)
      if (data?.error === 'email_taken') {
        setErrorMessage('That email is already associated with an account. Try signing in instead.')
      } else {
        setErrorMessage('Account setup failed. Please try again.')
      }
      return
    }

    setIsLoading(false)
    onUpgraded()
  }

  const handlePasskeySignIn = async () => {
    setErrorMessage(null)
    setIsLoading(true)

    const result = await authClient.signIn.passkey({ autoFill: false })
    if (result.error) {
      setIsLoading(false)
      if (errCode(result.error) === 'AUTH_CANCELLED') {
        setErrorMessage('Sign-in cancelled.')
      } else {
        setErrorMessage(result.error.message || 'Passkey sign-in failed.')
      }
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
      setErrorMessage('No account found for that passkey.')
      return
    }

    setIsLoading(false)
    onUpgraded()
  }

  const handleSocialSignIn = (provider: 'github' | 'apple') => {
    setErrorMessage(null)
    void authClient.signIn.social({ provider })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save your sightings</DialogTitle>
          <DialogDescription>
            Create an account to save your bird observations.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Social providers — top, like Reddit */}
          {providers && providers.length > 0 && (
            <div className="space-y-2">
              {providers.includes('github') && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => handleSocialSignIn('github')}
                  disabled={isLoading}
                >
                  <GithubLogo size={18} className="mr-2" />
                  Continue with GitHub
                </Button>
              )}
              {providers.includes('apple') && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => handleSocialSignIn('apple')}
                  disabled={isLoading}
                >
                  <AppleLogo size={18} className="mr-2" />
                  Continue with Apple
                </Button>
              )}
            </div>
          )}

          {/* OR divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">or</span>
            </div>
          </div>

          {/* Email + passkey */}
          <div className="space-y-3">
            <Input
              type="email"
              placeholder="Email (optional)"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
              aria-label="Email address"
            />
            <Button
              className="w-full"
              onClick={handleContinueWithPasskey}
              disabled={isLoading}
            >
              <Key size={18} className="mr-2" />
              {isLoading ? 'Working…' : 'Continue with passkey'}
            </Button>
          </div>

          {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <button
              className="text-primary underline-offset-4 hover:underline cursor-pointer"
              onClick={handlePasskeySignIn}
              disabled={isLoading}
            >
              Sign in
            </button>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
